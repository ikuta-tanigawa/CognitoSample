// KVSのためのグローバル変数
var localView = null;
var remoteView = null;
var sendVideoAudioCheck = null;
const clientId = 'viewer-' + generateUuid();
console.log('clientId=', clientId);
const globalKVS = {};

// 画面読み込み時の処理
$(document).ready(function() {
    localView = document.getElementById('local_video');
    remoteView = document.getElementById('remote_video');
    sendVideoAudioCheck = document.getElementById('send_video_audio_check');
    $("#start_button").click(function(event) {
        startViewer();
    });
    $("#stop_button").click(function(event) {
        stopViewer();
    });
    // KVSのクレデンシャル情報を取得 (kvs_webrtc_get_credentials.js)
    getKVSCredentials(function() { setupKVS(); });
});

async function setupKVS() {
  // --------- Create KVS Client -----
  const kinesisVideoClient = new AWS.KinesisVideo({
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
  });
  globalKVS.kinesisVideoClient = kinesisVideoClient;

  const getSignalingChannelEndpointResponse = await kinesisVideoClient
    .getSignalingChannelEndpoint({
      ChannelARN: channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ['WSS', 'HTTPS'],
        Role: KVSWebRTC.Role.VIEWER,
      },
    })
    .promise();
  const endpointsByProtocol = getSignalingChannelEndpointResponse.ResourceEndpointList.reduce((endpoints, endpoint) => {
    endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
    return endpoints;
  }, {});
  globalKVS.getSignalingChannelEndpointResponse = getSignalingChannelEndpointResponse;
  globalKVS.endpointsByProtocol = endpointsByProtocol;

  const kinesisVideoSignalingChannelsClient = new AWS.KinesisVideoSignalingChannels({
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    endpoint: endpointsByProtocol.HTTPS,
  });
  globalKVS.kinesisVideoSignalingChannelsClient = kinesisVideoSignalingChannelsClient;

  const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
    .getIceServerConfig({
      ChannelARN: channelARN,
    })
    .promise();
  const iceServers = [
    { urls: `stun:stun.kinesisvideo.${region}.amazonaws.com:443` }
  ];
  getIceServerConfigResponse.IceServerList.forEach(iceServer =>
    iceServers.push({
      urls: iceServer.Uris,
      username: iceServer.Username,
      credential: iceServer.Password,
    }),
  );
  globalKVS.iceServers = iceServers;

  const signalingClient = new KVSWebRTC.SignalingClient({
    channelARN,
    channelEndpoint: endpointsByProtocol.WSS,
    clientId,
    role: KVSWebRTC.Role.VIEWER,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    },
  });
  globalKVS.signalingClient = signalingClient;

  // Once the signaling channel connection is open, connect to the webcam and create an offer to send to the master
  signalingClient.on('open', async () => {
    console.log('signaling client open');

    // --- prepare new peer ---
    if (!globalKVS.peerConnection) {
      globalKVS.peerConnection = prepareNewPeer(globalKVS.iceServers, globalKVS.signalingClient);
    }
    else {
      console.warn('WARN: ALREADY peer exist');
    }

    if (isSendingVideoAudio()) {
      // Get a stream from the webcam, add it to the peer connection, and display it in the local view
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });
        globalKVS.localStream = localStream;
        localStream.getTracks().forEach(track => globalKVS.peerConnection.addTrack(track, localStream));

        playVideo(localView, localStream);
      } catch (e) {
        console.error('GUM , play error:', e);
        // Could not find webcam
        return;
      }
    }
    else {
      // --- recvonly ---
      //const peer = new RTCPeerConnection({ sdpSemantics: 'unified-plan' });
      if (globalKVS.peerConnection.addTransceiver) {
        globalKVS.peerConnection.addTransceiver('video', { direction: 'recvonly' });
        globalKVS.peerConnection.addTransceiver('audio', { direction: 'recvonly' });
      }
    }

    // Create an SDP offer and send it to the master
    const offer = await globalKVS.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await globalKVS.peerConnection.setLocalDescription(offer);
    console.log('send offer');
    signalingClient.sendSdpOffer(globalKVS.peerConnection.localDescription);
  });

  // When the SDP answer is received back from the master, add it to the peer connection.
  signalingClient.on('sdpAnswer', async answer => {
    console.log('got answer');
    await globalKVS.peerConnection.setRemoteDescription(answer);
  });

  // When an ICE candidate is received from the master, add it to the peer connection.
  signalingClient.on('iceCandidate', candidate => {
    console.log('got iceCandidate');
    globalKVS.peerConnection.addIceCandidate(candidate);
  });

  signalingClient.on('close', () => {
    // Handle client closures
    console.warn('signalingClient close');
  });

  signalingClient.on('error', error => {
    // Handle client errors
    console.error('signalingClient error', error);
  });
}

function prepareNewPeer(iceServers, signalingClient) {
  const peerConnection = new RTCPeerConnection({ iceServers });

  // Send any ICE candidates generated by the peer connection to the other peer
  peerConnection.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) {
      console.log('send iceCandidate');
      signalingClient.sendIceCandidate(candidate);
    } else {
      // No more ICE candidates will be generated
    }
  });

  // As remote tracks are received, add them to the remote view
  peerConnection.addEventListener('track', event => {
    console.log('on track');
    if (remoteView.srcObject) {
      return;
    }

    playVideo(remoteView, event.streams[0]);
  });

  // handle disconnect 
  peerConnection.addEventListener('iceconnectionstatechange', event => {
    console.log('on iceconnectionstatechange. iceState:', peerConnection.iceConnectionState, ' signalingState:', peerConnection.signalingState); //, 'connectionState:', peerConnection.connectionState);
    if (peerConnection.iceConnectionState === 'failed') {
      console.warn('remote peeer closed');
      stopVideo(remoteView);
      stopViewer();
    }
  });

  return peerConnection;
}

async function playVideo(element, stream) {
  element.srcObject = stream;
  await element.play().catch(err => console.error(err));
  element.volume = 0;
}

function stopVideo(element) {
  if (element.srcObject) {
    element.pause();
    element.srcObject = null;
  }
}

function generateUuid() {
  // refer
  //   https://qiita.com/psn/items/d7ac5bdb5b5633bae165
  //   https://github.com/GoogleChrome/chrome-platform-analytics/blob/master/src/internal/identifier.js
  // const FORMAT: string = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  let chars = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".split("");
  for (let i = 0, len = chars.length; i < len; i++) {
    switch (chars[i]) {
      case "x":
        chars[i] = Math.floor(Math.random() * 16).toString(16);
        break;
      case "y":
        chars[i] = (Math.floor(Math.random() * 4) + 8).toString(16);
        break;
    }
  }
  return chars.join("");
}

function isSendingVideoAudio() {
  return sendVideoAudioCheck.checked;
}

function startViewer() {
  console.log('-- start Viewer --');
  globalKVS.signalingClient.open();
}

function stopViewer() {
  console.log('-- stop Viewer --');

  stopVideo(localView);
  stopVideo(remoteView);

  if (globalKVS.signalingClient) {
    globalKVS.signalingClient.close();
    //globalKVS.signalingClient = null;
  }

  if (globalKVS.peerConnection) {
    globalKVS.peerConnection.close();
    globalKVS.peerConnection = null;
  }

  if (globalKVS.localStream) {
    globalKVS.localStream.getTracks().forEach(track => track.stop());
    globalKVS.localStream = null;
  }

  //if (globalKVS.remoteStream) {
  //  globalKVS.remoteStream.getTracks().forEach(track => track.stop());
  //  globalKVS.remoteStream = null;
  //}
}
