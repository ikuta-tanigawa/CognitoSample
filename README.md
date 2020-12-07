# CognitoSample
これは、Cognitoを使ったKVS WebRTCのサンプルプログラムである。

サンプルプログラムのファイル構成は下記の通りである。
```bash
.
├── signup.html
├── activation.html
├── signin.html
├── kvs_webrtc_master.html
├── kvs_webrtc_viewer.html
└── js
    ├── config.js
    ├── kvs_webrtc_get_credentials.js
    ├── signup.js
    ├── activation.js
    ├── signin.js
    ├── kvs_webrtc_master.js
    ├── kvs_webrtc_viewer.js
    └── aws-cognito/
```
サンプルプログラムでは、アカウントのサインアップ、アクティベーション、サインインや、KVSのマスター・ビュワーのためのhtmlファイルがある。また、これらに対応したjsファイルがあり、その中でそれぞれのhtmlで実行されるJavaScriptが記述されている。

`config.js`はユーザープール、IDプール、KVSなどのIDを設定するためのファイルで、各jsファイルから参照される。`kvs_webrtc_get_credentials`はマスター、ビュワーで共通する処理であり、KVSのクレデンシャル情報を取得するためのプログラムである。

このサンプルプログラムは、下記のサイトから拾ったソースコードを組み合わせて、サインインからKVSの通信までの一連の処理を行えるようにしたものである。細かいことを知りたい場合は、こちらも参考にされたし。
- [Amazon Cognitoを使ったサインイン画面をつくってみる](https://www.tdi.co.jp/miso/amazon-cognito-sign-up)
  - Cognitoを使ったログイン画面の作り方について解説している
  - Part1～Part4あたりまでを参考にした
- [Github: amazon-kinesis-video-streams-webrtc-sdk-js-with-amazon-cognito](https://github.com/aws-samples/amazon-kinesis-video-streams-webrtc-sdk-js-with-amazon-cognito)
  - Cognitoを使ったKVS WebRTCのサンプルプログラム
  - 公式サンプルのクレデンシャル情報のあたりをいじったようなもの
- [Github: kvs_webrtc_example](https://github.com/mganeko/kvs_webrtc_example)
  - KVS WebRTCのサンプルを簡略化したもの

以降、サンプルプログラムの動かし方とソースコードの解説を行う。

## サンプルプログラムの動かし方
まずは、`js/config.js`を開き、ユーザープール、アプリクライアント、IDプールのIDとKVSのARNを記述する。

次に、`signup.html`を開き、メールアドレスとパスワードを入力する。入力後`activation.html`に飛ぶので、メールアドレスに送られたコードを入力して、アカウントを有効にする。

サインインは、`signin.html`で行う。ここに登録したメールアドレスとパスワードを入力し、KVSにマスター側でアクセスしたい場合は`Sign In Master`、ビュワー側の場合は`Sign In Viewer`ボタンを押す。

一台のPCで実験する場合は、もう片方の通信画面は`kvs_webrtc_master.html`か`kvs_webrtc_viewer.html`を直接開くと同じアカウントによって通信を確立できる（ログインの記録がセッション情報としてしばらく保存されているので）。

## サンプルプログラムの解説
サインアップ、アクティベーション、サインインに関しては、基本的には、IDやパスワードなど必要な情報をユーザープールに与えて、その返事を待つだけなので簡単に理解できる内容である。

ログイン後にKVSのクレデンシャル情報を受け取る処理については、`kvs_webrtc_get_credentials.js`に記述している。内容は以下の通りである。
```javascript
// KVSのためのグローバル変数
var accessKeyId = "";
var secretAccessKey = "";
var sessionToken =  "";

// KVSのクレデンシャル情報を取得
function getKVSCredentials(callback){
    // 現在のユーザ
    const cognitoUser = userPool.getCurrentUser();
    // 現在のユーザー情報が取得できているか？
    if (cognitoUser != null) {
        cognitoUser.getSession(function(err, session) {
            if (err) {
                console.log(err);
                $(location).attr("href", "signin.html");
            } else {
                // セッション情報からKVSのクレデンシャル情報を取得
                var idToken = session.getIdToken().getJwtToken();
                AWS.config.region = region;
                AWS.config.credentials = new AWS.CognitoIdentityCredentials({
                    IdentityPoolId: identityPoolId,
                    Logins: {
                        [`cognito-idp.${region}.amazonaws.com/${poolData.UserPoolId}`]: idToken,
                    },
                });
                //refreshes credentials using AWS.CognitoIdentity.getCredentialsForIdentity()
                AWS.config.credentials.refresh(error => {
                    if (error) {
                        console.log(error);
                    } else  {
                        // クレデンシャル情報を変数に保存し、KVSのセットアップを開始する
                        accessKeyId = AWS.config.credentials.accessKeyId;
                        secretAccessKey = AWS.config.credentials.secretAccessKey;
                        sessionToken =  AWS.config.credentials.sessionToken;
                        callback();
                    }
                });
            }
        });
    } else {
        $(location).attr("href", "signin.html");
    }
};
```

このプログラムでは、`signin.html(.js)`で取得したユーザープールのアカウント情報をセッション情報から再度取得している。セッション情報はCognitoのライブラリから取得することができる。

取得したセッション情報からIDトークンと呼ばれるものを取り出し、それをIDプールに渡すことで、`accessKeyId`、`secretAccessKey`、`sessionToken`を取得することができる。

あとは、これらのクレデンシャル情報を普段KVS WebRTCを使うのと同じ方法で利用することで、KVS WebRTCの通信を行うことが可能となる。サンプルプログラムでは、`kvs_webrtc_master.js`や`kvs_webrtc_viewer.js`で定義した関数をコールバックとして呼び出し、その後の処理を行っている。
