// 画面読み込み時の処理
$(document).ready(function() {
    $("#activationButton").click(function(event) {
        activate();
    });
});
 
// アクティベーション処理
function activate() {
    var email = $("#email").val();
    var activationKey = $("#activationKey").val();
    if (!email | !activationKey) {
        return false;
    }

    var userData = {
        Username : email,
        Pool : userPool
    };
    var cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

    // アクティベーション処理
    cognitoUser.confirmRegistration(activationKey, true, function(err, result){
        if (err) {
            if (err.message != null) {
                $("div#message span").empty();
                $("div#message span").append(err.message);
            }
        } else {
            $(location).attr("href", "signin.html");
        }
    });
};
