// 画面読み込み時の処理
$(document).ready(function() {
    $("#createAccount").click(function(event) {
        signUp();
    });
});
 
// サインアップ処理
function signUp() {
    var username = $("#email").val();
    var password = $("#password").val();
    if (!username | !password) { 
        return false; 
    }

    // ユーザ属性リストの生成
    var attributeList = [];
    var email = {
        Name : "email",
        Value : username
    }
    var attributeEmail = new AmazonCognitoIdentity.CognitoUserAttribute(email);
    attributeList.push(attributeEmail);

    // サインアップ処理
    userPool.signUp(username, password, attributeList, null, function(err, result){
        if (err) {
            alert(err);
            return;
        }
        else {
            $(location).attr("href", "activation.html");
        }
    });
}
