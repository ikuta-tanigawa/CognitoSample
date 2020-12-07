// 画面読み込み時の処理
$(document).ready(function() {
    $("#signinButtonMaster").click(function(event) {
        signIn("kvs_webrtc_master.html");
    });
    $("#signinButtonViewer").click(function(event) {
        signIn("kvs_webrtc_viewer.html");
    });
});
 
// サインイン処理
function signIn(nextPage) {
    var email = $('#email').val();
    var password = $('#password').val();
    if (!email | !password) { 
    	$("#signin div#message span").empty();
    	$("#signin div#message span").append("All fields are required.");
    	return false; 
    }

    // 認証データの作成
    var authenticationData = {
        Username: email,
        Password: password
    };
    var authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails(authenticationData);

    var userData = {
        Username: email,
        Pool: userPool
    };
    var cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

    // 認証処理
    cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: function (result) {
            //var idToken = result.getIdToken().getJwtToken();
            //var accessToken = result.getAccessToken().getJwtToken();
            //var refreshToken = result.getRefreshToken().getToken();
            // サインイン成功の場合、次の画面へ遷移
            $(location).attr("href", nextPage);
        },
        onFailure: function(err) {
            // サインイン失敗の場合、エラーメッセージを画面に表示
            console.log(err);
            $("div#message span").empty();
            $("div#message span").append(err.message);
        }
    });
};
