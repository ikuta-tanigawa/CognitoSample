// KVSのためのグローバル変数
var localView = null;
var remoteView = null;
var sendVideoAudioCheck = null;
const clientId = null;
const globalKVS = {};

// 画面読み込み時の処理
$(document).ready(function() {
    localView = document.getElementById('local_video');
    remoteView = document.getElementById('remote_video');
    sendVideoAudioCheck = document.getElementById('send_video_audio_check');
    $("#start_button").click(function(event) {
        startMaster();
    });
    $("#stop_button").click(function(event) {
        stopMaster();
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
        Role: KVSWebRTC.Role.MASTER,
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
    role: KVSWebRTC.Role.MASTER,
    region: region,
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
    // await prepareMedia();
  });

  // When the SDP answer is received back from the master, add it to the peer connection.
  signalingClient.on('sdpAnswer', async answer => {
    console.warn('waiting offer');
  });

  const DERAULT_MASTER = 'AWS_DEFAULT_SINGLE_MASTER'
  signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
    console.log('got Offer, remoteId=', remoteClientId);

    // --- prepare new peer ---
    if (!globalKVS.peerConnection) {
      globalKVS.peerConnection = prepareNewPeer(globalKVS.iceServers, globalKVS.signalingClient, remoteClientId);
    }
    else {
      console.warn('WARN: ALREADY peer exist');
    }
    const peer = globalKVS.peerConnection;
    const localStream = globalKVS.localStream;
    if (localStream) {
      localStream.getTracks().forEach(track => peer.addTrack(track, localStream));
    }
    else {
      // --- recvonly ---
      //const peer = new RTCPeerConnection({ sdpSemantics: 'unified-plan' });
      if (peer.addTransceiver) {
        peer.addTransceiver('video', { direction: 'recvonly' });
        peer.addTransceiver('audio', { direction: 'recvonly' });
      }
    }

    await peer.setRemoteDescription(offer);
    await peer.setLocalDescription(
      await peer.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      }),
    );

    // send back asnwer
    console.log('sending answer, remoteId=', remoteClientId)
    signalingClient.sendSdpAnswer(peer.localDescription, remoteClientId);
  });

  // When an ICE candidate is received from the master, add it to the peer connection.
  signalingClient.on('iceCandidate', (candidate, remoteClientId) => {
    console.log('got iceCandidate from', remoteClientId);
    let peer = globalKVS.peerConnection;

    peer.addIceCandidate(candidate);
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

function prepareNewPeer(iceServers, signalingClient, remoteClientId) {
  const peerConnection = new RTCPeerConnection({ iceServers });

  // Send any ICE candidates generated by the peer connection to the other peer
  peerConnection.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) {
      console.log('send iceCandidate');
      signalingClient.sendIceCandidate(candidate, remoteClientId);
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
      closePeer();
    }
  });

  return peerConnection;
}

async function prepareMedia() {
  if (isSendingVideoAudio()) {
    // Get a stream from the webcam, add it to the peer connection, and display it in the local view
    try {
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
      globalKVS.localStream = localStream;
      playVideo(localView, localStream);
    } catch (e) {
      console.error('GUM , play error:', e);
      // Could not find webcam
      return;
    }
  }
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

function isSendingVideoAudio() {
  return sendVideoAudioCheck.checked;
}

async function startMaster() {
  console.log('-- start Master --');
  await prepareMedia();
  globalKVS.signalingClient.open();
}

function stopMaster() {
  console.log('--- stop Master ---');
  stopVideo(localView);
  stopVideo(remoteView);

  if (globalKVS.signalingClient) {
    globalKVS.signalingClient.close();
    //globalKVS.signalingClient = null;
  }
  else {
    console.warn('NO globalKVS.signalingClient');
  }
  if (globalKVS.peerConnection) {
    globalKVS.peerConnection.close();
    globalKVS.peerConnection = null;
  }
  else {
    console.warn('NO globalKVS.peerConnection');
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

function closePeer() {
  if (globalKVS.peerConnection) {
    globalKVS.peerConnection.close();
    globalKVS.peerConnection = null;
  }
}
