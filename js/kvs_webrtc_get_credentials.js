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
