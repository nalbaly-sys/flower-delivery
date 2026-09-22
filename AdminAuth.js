//==================================================
// AdminAuth.gs
// Master / SubMaster Authentication Engine
// 무제한 로그인 유지 버전
//==================================================

var ADMIN_SHEET_NAME="관리자계정_DB";
var ADMIN_SESSION_PREFIX="ADMIN_SESSION_";
var ADMIN_SESSION_SECONDS=21600; // 기존 호환용. PropertiesService 사용으로 실제 만료 없음.
var ADMIN_COL={ID:0,NAME:1,PASSWORD:2,ROLE:3,STATUS:4,CREATED:5,LAST_LOGIN:6,FCM_TOKEN:7};

//==================================================
// 관리자 계정 DB
//==================================================

function getAdminSheet(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sheet=ss.getSheetByName(ADMIN_SHEET_NAME);
  if(!sheet){
    sheet=ss.insertSheet(ADMIN_SHEET_NAME);
    sheet.getRange(1,1,1,8).setValues([["계정ID","이름","비밀번호","권한","상태","생성시간","마지막로그인","FCM Token"]]);
    sheet.setFrozenRows(1);
  }else if(sheet.getLastColumn()<8){
    sheet.getRange(1,1,1,8).setValues([["계정ID","이름","비밀번호","권한","상태","생성시간","마지막로그인","FCM Token"]]);
  }
  return sheet;
}

//==================================================
// 최초 MASTER 계정 생성
//==================================================

function createInitialMaster(){
  const sheet=getAdminSheet();
  const id="Aa",name="최고관리자",password="1234",role="MASTER",status="사용";
  const data=sheet.getDataRange().getValues();

  for(let i=1;i<data.length;i++){
    if(String(data[i][ADMIN_COL.ID]||"").trim()===id)return {success:false,message:"MASTER 계정이 이미 존재합니다."};
  }

  sheet.appendRow([id,name,password,role,status,new Date(),"",""]);
  SpreadsheetApp.flush();

  return {success:true,message:"최초 MASTER 계정 생성 완료",id:id,password:password};
}

//==================================================
// 관리자 로그인
// 기존 공용 로그인 - 기존 기능 유지
//==================================================

function verifyAdminLogin(accountId,password){
  try{
    accountId=String(accountId||"").trim();
    password=String(password||"").trim();

    Logger.log("========================================");
    Logger.log("🔐 ADMIN LOGIN REQUEST");
    Logger.log("ID = "+accountId);
    Logger.log("========================================");

    if(!accountId||!password){
      return {success:false,message:"아이디와 비밀번호를 입력해주세요."};
    }

    const sheet=getAdminSheet();
    if(!sheet){
      return {success:false,message:"관리자 DB를 찾을 수 없습니다."};
    }

    const data=sheet.getDataRange().getValues();

    for(let i=1;i<data.length;i++){
      const id=String(data[i][ADMIN_COL.ID]||"").trim();
      const pwd=String(data[i][ADMIN_COL.PASSWORD]||"").trim();
      const role=String(data[i][ADMIN_COL.ROLE]||"").trim().toUpperCase();
      const status=String(data[i][ADMIN_COL.STATUS]||"").trim();

      if(id!==accountId)continue;

      if(status!=="사용"){
        Logger.log("❌ 계정 사용중지 : "+id);
        return {success:false,message:"사용이 중지된 계정입니다."};
      }

      if(pwd!==password){
        Logger.log("❌ 비밀번호 불일치 : "+id);
        return {success:false,message:"비밀번호가 일치하지 않습니다."};
      }

      const token=Utilities.getUuid();

      const session={
        id:id,
        name:String(data[i][ADMIN_COL.NAME]||"").trim(),
        role:role
      };

      const propertyKey=ADMIN_SESSION_PREFIX+token;

      PropertiesService
        .getScriptProperties()
        .setProperty(
          propertyKey,
          JSON.stringify(session)
        );

      sheet
        .getRange(i+1,ADMIN_COL.LAST_LOGIN+1)
        .setValue(new Date());

      SpreadsheetApp.flush();

      Logger.log("✅ ADMIN LOGIN SUCCESS");
      Logger.log("ID = "+session.id);
      Logger.log("ROLE = "+session.role);
      Logger.log("TOKEN LENGTH = "+token.length);
      Logger.log("SESSION = PERMANENT UNTIL LOGOUT");

      return {
        success:true,
        token:token,
        sessionToken:token,
        id:session.id,
        name:session.name,
        role:session.role
      };
    }

    Logger.log("❌ 관리자 계정 없음 : "+accountId);

    return {
      success:false,
      message:"등록되지 않은 관리자 계정입니다."
    };

  }catch(err){

    Logger.log("verifyAdminLogin ERROR : "+err);

    return {
      success:false,
      message:"로그인 서버 오류 : "+(err&&err.message?err.message:err)
    };
  }
}


//==================================================
// AdminApp 전용 로그인
// ADMIN 권한만 허용
//==================================================

function verifyAdminAppLogin(accountId,password){
  try{
    accountId=String(accountId||"").trim();
    password=String(password||"").trim();

    Logger.log("========================================");
    Logger.log("🔐 AdminApp LOGIN REQUEST");
    Logger.log("ID = "+accountId);
    Logger.log("========================================");

    if(!accountId||!password){
      return {
        success:false,
        message:"아이디와 비밀번호를 입력해주세요."
      };
    }

    const sheet=getAdminSheet();

    if(!sheet){
      return {
        success:false,
        message:"관리자 DB를 찾을 수 없습니다."
      };
    }

    const data=sheet.getDataRange().getValues();

    for(let i=1;i<data.length;i++){

      const id=String(
        data[i][ADMIN_COL.ID]||""
      ).trim();

      const pwd=String(
        data[i][ADMIN_COL.PASSWORD]||""
      ).trim();

      const role=String(
        data[i][ADMIN_COL.ROLE]||""
      ).trim().toUpperCase();

      const status=String(
        data[i][ADMIN_COL.STATUS]||""
      ).trim();

      if(id!==accountId)continue;

      if(status!=="사용"){
        Logger.log("❌ AdminApp 계정 사용중지 : "+id);

        return {
          success:false,
          message:"사용이 중지된 계정입니다."
        };
      }

      if(pwd!==password){
        Logger.log("❌ AdminApp 비밀번호 불일치 : "+id);

        return {
          success:false,
          message:"비밀번호가 일치하지 않습니다."
        };
      }

      //==========================================
      // ⭐ 핵심
      // AdminApp은 ADMIN 권한만 허용
      //==========================================

      if(role!=="ADMIN"){
        Logger.log("❌ AdminApp ADMIN 권한 아님");
        Logger.log("ID = "+id);
        Logger.log("ROLE = "+role);

        return {
          success:false,
          message:"AdminApp은 관리자(ADMIN) 계정만 로그인할 수 있습니다."
        };
      }

      const token=Utilities.getUuid();

      const session={
        id:id,
        name:String(
          data[i][ADMIN_COL.NAME]||""
        ).trim(),
        role:role
      };

      const propertyKey=
        ADMIN_SESSION_PREFIX+token;

      PropertiesService
        .getScriptProperties()
        .setProperty(
          propertyKey,
          JSON.stringify(session)
        );

      sheet
        .getRange(
          i+1,
          ADMIN_COL.LAST_LOGIN+1
        )
        .setValue(new Date());

      SpreadsheetApp.flush();

      Logger.log("========================================");
      Logger.log("✅ AdminApp LOGIN SUCCESS");
      Logger.log("ID = "+session.id);
      Logger.log("ROLE = "+session.role);
      Logger.log("TOKEN LENGTH = "+token.length);
      Logger.log("========================================");

      return {
        success:true,
        token:token,
        sessionToken:token,
        id:session.id,
        name:session.name,
        role:session.role
      };
    }

    Logger.log(
      "❌ AdminApp 관리자 계정 없음 : "+accountId
    );

    return {
      success:false,
      message:"등록되지 않은 관리자 계정입니다."
    };

  }catch(err){

    Logger.log(
      "verifyAdminAppLogin ERROR : "+err
    );

    return {
      success:false,
      message:
        "로그인 서버 오류 : "+
        (err&&err.message?err.message:err)
    };
  }
}


//==================================================
// 관리자 로그인 - index.html 호환용
// 기존 기능 유지
//==================================================

function loginAdmin(accountId,password){
  return verifyAdminLogin(accountId,password);
}

//==================================================
// 로그인 세션 확인
// ※ 세션 만료 없음 / 로그아웃할 때까지 유지
//==================================================
function verifyAdminSession(token,requiredRole){
  try{
    token=String(token||"").trim();
    requiredRole=String(requiredRole||"").trim().toUpperCase();

    if(!token)return {success:false,message:"로그인이 필요합니다."};

    const propertyKey=ADMIN_SESSION_PREFIX+token;
    const raw=PropertiesService.getScriptProperties().getProperty(propertyKey);

    if(!raw){
      return {success:false,message:"로그인 세션이 존재하지 않습니다."};
    }

    let session;
    try{
      session=JSON.parse(raw);
    }catch(parseErr){
      Logger.log("❌ SESSION JSON ERROR : "+parseErr);
      PropertiesService.getScriptProperties().deleteProperty(propertyKey);
      return {success:false,message:"로그인 세션이 손상되었습니다."};
    }

    if(!session||!session.id||!session.role){
      return {success:false,message:"유효하지 않은 로그인 세션입니다."};
    }

    const sessionRole=String(session.role||"").trim().toUpperCase();

    if(requiredRole&&sessionRole!==requiredRole){
      Logger.log("❌ ROLE DENIED : "+sessionRole+" / REQUIRED : "+requiredRole);
      return {success:false,message:"접근 권한이 없습니다."};
    }

    Logger.log("✅ SESSION VALID : "+session.id+" / "+sessionRole);

    return {
      success:true,
      id:String(session.id||""),
      name:String(session.name||""),
      role:sessionRole
    };

  }catch(err){
    Logger.log("verifyAdminSession ERROR : "+err);
    return {success:false,message:"세션 확인 오류 : "+(err&&err.message?err.message:err)};
  }
}

//==================================================
// 로그아웃
// ※ 사용자가 직접 로그아웃할 때만 영구 세션 삭제
//==================================================
function logoutAdmin(token){
  try{
    token=String(token||"").trim();

    Logger.log("========================================");
    Logger.log("🚪 ADMIN LOGOUT REQUEST");
    Logger.log("TOKEN LENGTH = "+token.length);
    Logger.log("========================================");

    if(!token){
      return {success:true,message:"로그아웃되었습니다."};
    }

    const propertyKey=ADMIN_SESSION_PREFIX+token;

    PropertiesService.getScriptProperties().deleteProperty(propertyKey);

    Logger.log("✅ PERMANENT SESSION REMOVED");
    Logger.log("KEY = "+propertyKey);

    return {
      success:true,
      message:"로그아웃되었습니다."
    };

  }catch(err){
    Logger.log("logoutAdmin ERROR : "+err);
    return {
      success:false,
      message:"로그아웃 처리 중 오류가 발생했습니다."
    };
  }
}

//==================================================
// 기존 Code/UI 함수명 호환용
//==================================================

function createSubMaster(token,accountId,name,password){
  return createSubMasterAccount(token,accountId,name,password);
}

function updateSubMasterStatus(token,accountId,status){
  return setSubMasterStatus(token,accountId,status);
}

function resetSubMasterPassword(token,accountId,newPassword){
  return changeSubMasterPassword(token,accountId,newPassword);
}

//==================================================
// SUBMASTER 생성
//==================================================

function createSubMasterAccount(token,accountId,name,password){
  const session=verifyAdminSession(token,"MASTER");
  if(!session.success)return session;

  accountId=String(accountId||"").trim();
  name=String(name||"").trim();
  password=String(password||"").trim();

  if(!accountId||!name||!password){
    return {
      success:false,
      message:"아이디, 이름, 비밀번호를 모두 입력해주세요."
    };
  }

  const sheet=getAdminSheet();
  const data=sheet.getDataRange().getValues();

  for(let i=1;i<data.length;i++){
    if(
      String(data[i][ADMIN_COL.ID]||"").trim()===accountId
    ){
      return {
        success:false,
        message:"이미 존재하는 계정ID입니다."
      };
    }
  }

  sheet.appendRow([
    accountId,
    name,
    password,
    "SUBMASTER",
    "사용",
    new Date(),
    "",
    ""
  ]);

  SpreadsheetApp.flush();

  return {
    success:true,
    message:"부마스터 계정이 생성되었습니다.",
    id:accountId
  };
}

//==================================================
// SUBMASTER 비밀번호 변경
//==================================================

function changeSubMasterPassword(token,accountId,newPassword){
  const session=verifyAdminSession(token,"MASTER");
  if(!session.success)return session;

  accountId=String(accountId||"").trim();
  newPassword=String(newPassword||"").trim();

  if(!accountId||!newPassword){
    return {
      success:false,
      message:"계정ID와 새 비밀번호를 입력해주세요."
    };
  }

  const sheet=getAdminSheet();
  const data=sheet.getDataRange().getValues();

  for(let i=1;i<data.length;i++){
    if(
      String(data[i][ADMIN_COL.ID]||"").trim()===accountId
    ){
      if(
        String(data[i][ADMIN_COL.ROLE]||"")
          .trim()
          .toUpperCase()!=="SUBMASTER"
      ){
        return {
          success:false,
          message:"부마스터 계정이 아닙니다."
        };
      }

      sheet
        .getRange(i+1,ADMIN_COL.PASSWORD+1)
        .setValue(newPassword);

      SpreadsheetApp.flush();

      return {
        success:true,
        message:"비밀번호가 변경되었습니다."
      };
    }
  }

  return {
    success:false,
    message:"부마스터 계정을 찾을 수 없습니다."
  };
}

//==================================================
// SUBMASTER 상태 변경
//==================================================

function setSubMasterStatus(token,accountId,status){
  const session=verifyAdminSession(token,"MASTER");
  if(!session.success)return session;

  accountId=String(accountId||"").trim();
  status=String(status||"").trim();

  if(status!=="사용"&&status!=="중지"){
    return {
      success:false,
      message:"잘못된 상태입니다."
    };
  }

  const sheet=getAdminSheet();
  const data=sheet.getDataRange().getValues();

  for(let i=1;i<data.length;i++){
    if(
      String(data[i][ADMIN_COL.ID]||"").trim()===accountId
    ){
      if(
        String(data[i][ADMIN_COL.ROLE]||"")
          .trim()
          .toUpperCase()!=="SUBMASTER"
      ){
        return {
          success:false,
          message:"부마스터 계정이 아닙니다."
        };
      }

      sheet
        .getRange(i+1,ADMIN_COL.STATUS+1)
        .setValue(status);

      SpreadsheetApp.flush();

      return {
        success:true,
        message:"계정 상태가 변경되었습니다."
      };
    }
  }

  return {
    success:false,
    message:"부마스터 계정을 찾을 수 없습니다."
  };
}

//==================================================
// 관리자 목록
//==================================================

function getAdminAccountList(token){
  const session=verifyAdminSession(token,"MASTER");
  if(!session.success)return session;

  const data=getAdminSheet().getDataRange().getValues();
  const result=[];

  for(let i=1;i<data.length;i++){
    if(!data[i])continue;

    result.push({
      id:String(data[i][ADMIN_COL.ID]||""),
      name:String(data[i][ADMIN_COL.NAME]||""),
      role:String(data[i][ADMIN_COL.ROLE]||""),
      status:String(data[i][ADMIN_COL.STATUS]||""),
      created:data[i][ADMIN_COL.CREATED],
      lastLogin:data[i][ADMIN_COL.LAST_LOGIN]
    });
  }

  return {
    success:true,
    list:result
  };
}

//==================================================
// 관리자 FCM Token 저장
// 관리자계정_DB H열 고정
//==================================================

function saveAdminFcmToken(accountId,token){
  try{
    accountId=String(accountId||"").trim();
    token=String(token||"").trim();

    Logger.log("=================================");
    Logger.log("📥 saveAdminFcmToken 호출");
    Logger.log("accountId="+accountId);
    Logger.log("token="+(
      token
      ? token.substring(0,20)+"..."
      : "없음"
    ));
    Logger.log("token length="+token.length);
    Logger.log("=================================");

    if(!accountId){
      return {
        success:false,
        error:"Missing accountId"
      };
    }

    if(!token){
      return {
        success:false,
        error:"Missing token"
      };
    }

    const sheet=getAdminSheet();

    if(!sheet){
      return {
        success:false,
        error:"관리자계정_DB를 찾을 수 없습니다."
      };
    }

    const lastRow=sheet.getLastRow();

    if(lastRow<2){
      return {
        success:false,
        error:"관리자계정_DB 데이터가 없습니다."
      };
    }

    const data=sheet
      .getRange(1,1,lastRow,8)
      .getValues();

    let targetRow=-1;

    for(let i=1;i<data.length;i++){
      const rowAccountId=
        String(data[i][0]||"").trim();

      if(rowAccountId===accountId){
        targetRow=i+1;
        break;
      }
    }

    if(targetRow===-1){
      Logger.log(
        "❌ 관리자 ID 없음="+accountId
      );

      return {
        success:false,
        error:"Admin ID not found",
        accountId:accountId
      };
    }

    const status=
      String(
        sheet.getRange(targetRow,7).getValue()||""
      ).trim();

    Logger.log("👑 관리자 행="+targetRow);
    Logger.log("👑 관리자 ID="+accountId);
    Logger.log("👑 상태="+status);

    const targetCol=8;

    const oldToken=
      String(
        sheet.getRange(
          targetRow,
          targetCol
        ).getValue()||""
      ).trim();

    Logger.log(
      "기존 Token="+
      (
        oldToken
        ? oldToken.substring(0,20)+"..."
        : "없음"
      )
    );

    Logger.log(
      "새 Token="+
      token.substring(0,20)+"..."
    );

    sheet
      .getRange(targetRow,targetCol)
      .setValue(token);

    SpreadsheetApp.flush();

    const savedToken=
      String(
        sheet
          .getRange(
            targetRow,
            targetCol
          )
          .getValue()||""
      ).trim();

    Logger.log("=================================");
    Logger.log("💾 관리자 FCM Token 저장 검증");
    Logger.log("행="+targetRow);
    Logger.log("열=H(8)");
    Logger.log("입력 길이="+token.length);
    Logger.log("저장 길이="+savedToken.length);
    Logger.log("저장 일치="+(savedToken===token));
    Logger.log(
      "저장 Token="+
      (
        savedToken
        ? savedToken.substring(0,20)+"..."
        : "없음"
      )
    );
    Logger.log("=================================");

    if(savedToken!==token){
      return {
        success:false,
        error:"FCM Token 저장 검증 실패",
        accountId:accountId,
        row:targetRow
      };
    }

    return {
      success:true,
      accountId:accountId,
      row:targetRow,
      column:"H",
      saved:true
    };

  }catch(e){
    Logger.log(
      "❌ saveAdminFcmToken 오류="+
      e.toString()
    );

    return {
      success:false,
      error:e.toString()
    };
  }
}

//==================================================
// 👑 MasterApp FCM Token 저장
//
// 관리자계정_DB
// H열 = 기존 AdminApp FCM Token
// I열 = MasterApp FCM Token
//
// ⚠️ 기존 saveAdminFcmToken()은 절대 수정하지 않음
//==================================================
function saveMasterFcmToken(accountId, token){

  try{

    accountId = String(accountId || "").trim();
    token = String(token || "").trim();

    Logger.log("=================================");
    Logger.log("👑 saveMasterFcmToken 호출");
    Logger.log("accountId = " + accountId);
    Logger.log(
      "token = " +
      (
        token
        ? token.substring(0,20) + "..."
        : "없음"
      )
    );
    Logger.log("token length = " + token.length);
    Logger.log("=================================");

    if(!accountId){

      return {
        success:false,
        error:"Missing accountId"
      };

    }

    if(!token){

      return {
        success:false,
        error:"Missing token"
      };

    }

    const sheet = getAdminSheet();

    if(!sheet){

      return {
        success:false,
        error:"관리자계정_DB를 찾을 수 없습니다."
      };

    }

    const lastRow = sheet.getLastRow();

    if(lastRow < 2){

      return {
        success:false,
        error:"관리자계정_DB 데이터가 없습니다."
      };

    }

    const data =
      sheet
        .getRange(
          1,
          1,
          lastRow,
          1
        )
        .getValues();

    let targetRow = -1;

    for(let i=1; i<data.length; i++){

      const rowAccountId =
        String(
          data[i][0] || ""
        ).trim();

      if(rowAccountId === accountId){

        targetRow = i + 1;
        break;

      }

    }

    if(targetRow === -1){

      Logger.log(
        "❌ MasterApp 관리자 ID 없음 = " +
        accountId
      );

      return {
        success:false,
        error:"Admin ID not found",
        accountId:accountId
      };

    }

    //==================================================
    // I열 = MasterApp FCM Token
    //==================================================
    const targetCol = 9;

    const oldToken =
      String(
        sheet
          .getRange(
            targetRow,
            targetCol
          )
          .getValue() || ""
      ).trim();

    Logger.log(
      "기존 MasterApp Token = " +
      (
        oldToken
        ? oldToken.substring(0,20) + "..."
        : "없음"
      )
    );

    Logger.log(
      "새 MasterApp Token = " +
      token.substring(0,20) +
      "..."
    );

    sheet
      .getRange(
        targetRow,
        targetCol
      )
      .setValue(token);

    SpreadsheetApp.flush();

    const savedToken =
      String(
        sheet
          .getRange(
            targetRow,
            targetCol
          )
          .getValue() || ""
      ).trim();

    if(savedToken !== token){

      Logger.log(
        "❌ MasterApp Token 저장 검증 실패"
      );

      return {
        success:false,
        error:"MasterApp FCM Token 저장 검증 실패"
      };

    }

    Logger.log(
      "✅ MasterApp FCM Token 저장 성공"
    );

    Logger.log(
      "👑 관리자 ID = " +
      accountId
    );

    Logger.log(
      "📍 저장 열 = I"
    );

    return {
      success:true,
      accountId:accountId,
      column:"I",
      message:"MasterApp FCM Token 저장 성공"
    };

  }catch(err){

    Logger.log(
      "❌ saveMasterFcmToken 오류 = " +
      err.toString()
    );

    return {
      success:false,
      error:err.toString()
    };

  }

}

//==================================================
// AdminApp 전용 로그인
// ADMIN 권한만 허용
//==================================================

function verifyAdminAppLogin(accountId,password){
  try{
    accountId=String(accountId||"").trim();
    password=String(password||"").trim();

    Logger.log("========================================");
    Logger.log("🔐 AdminApp LOGIN REQUEST");
    Logger.log("ID = "+accountId);
    Logger.log("========================================");

    if(!accountId||!password){
      return {
        success:false,
        message:"아이디와 비밀번호를 입력해주세요."
      };
    }

    const sheet=getAdminSheet();

    if(!sheet){
      return {
        success:false,
        message:"관리자 DB를 찾을 수 없습니다."
      };
    }

    const data=sheet.getDataRange().getValues();

    for(let i=1;i<data.length;i++){

      const id=String(
        data[i][ADMIN_COL.ID]||""
      ).trim();

      const pwd=String(
        data[i][ADMIN_COL.PASSWORD]||""
      ).trim();

      const role=String(
        data[i][ADMIN_COL.ROLE]||""
      ).trim().toUpperCase();

      const status=String(
        data[i][ADMIN_COL.STATUS]||""
      ).trim();

      if(id!==accountId)continue;

      if(status!=="사용"){
        Logger.log("❌ AdminApp 계정 사용중지 : "+id);

        return {
          success:false,
          message:"사용이 중지된 계정입니다."
        };
      }

      if(pwd!==password){
        Logger.log("❌ AdminApp 비밀번호 불일치 : "+id);

        return {
          success:false,
          message:"비밀번호가 일치하지 않습니다."
        };
      }

      // ⭐ 핵심: AdminApp은 ADMIN만 허용
      if(role!=="MASTER"){
        Logger.log("❌ AdminApp ADMIN 권한 아님");
        Logger.log("ID = "+id);
        Logger.log("ROLE = "+role);

        return {
          success:false,
          message:"AdminApp은 관리자(ADMIN) 계정만 로그인할 수 있습니다."
        };
      }

      const token=Utilities.getUuid();

      const session={
        id:id,
        name:String(
          data[i][ADMIN_COL.NAME]||""
        ).trim(),
        role:role
      };

      const propertyKey=
        ADMIN_SESSION_PREFIX+token;

      PropertiesService
        .getScriptProperties()
        .setProperty(
          propertyKey,
          JSON.stringify(session)
        );

      sheet
        .getRange(
          i+1,
          ADMIN_COL.LAST_LOGIN+1
        )
        .setValue(new Date());

      SpreadsheetApp.flush();

      Logger.log("========================================");
      Logger.log("✅ AdminApp LOGIN SUCCESS");
      Logger.log("ID = "+session.id);
      Logger.log("ROLE = "+session.role);
      Logger.log("TOKEN LENGTH = "+token.length);
      Logger.log("========================================");

      return {
        success:true,
        token:token,
        sessionToken:token,
        id:session.id,
        name:session.name,
        role:session.role
      };
    }

    Logger.log(
      "❌ AdminApp 관리자 계정 없음 : "+accountId
    );

    return {
      success:false,
      message:"등록되지 않은 관리자 계정입니다."
    };

  }catch(err){

    Logger.log(
      "verifyAdminAppLogin ERROR : "+err
    );

    return {
      success:false,
      message:
        "로그인 서버 오류 : "+
        (err&&err.message?err.message:err)
    };
  }
}


//==================================================
// AdminApp 전용 세션 확인
// ADMIN 권한만 자동 로그인 허용
//==================================================

function verifyAdminAppSession(token){

  try{

    token=String(token||"").trim();

    Logger.log("========================================");
    Logger.log("🔐 AdminApp SESSION CHECK");
    Logger.log("TOKEN LENGTH = "+token.length);
    Logger.log("========================================");

    if(!token){
      return {
        success:false,
        message:"로그인 세션이 없습니다."
      };
    }

    const propertyKey=
      ADMIN_SESSION_PREFIX+token;

    const sessionText=
      PropertiesService
        .getScriptProperties()
        .getProperty(propertyKey);

    if(!sessionText){

      Logger.log("❌ AdminApp 세션 없음");

      return {
        success:false,
        message:"로그인 세션이 만료되었습니다."
      };
    }

    let session;

    try{
      session=JSON.parse(sessionText);
    }catch(parseErr){

      Logger.log(
        "❌ AdminApp 세션 JSON 오류 = "+
        parseErr
      );

      PropertiesService
        .getScriptProperties()
        .deleteProperty(propertyKey);

      return {
        success:false,
        message:"로그인 세션이 올바르지 않습니다."
      };
    }

    const role=
      String(session.role||"")
        .trim()
        .toUpperCase();

    // ⭐ 핵심: 기존 MASTER 세션으로 AdminApp 자동 로그인 차단
    if(role!=="MASTER"){

      Logger.log("❌ AdminApp 세션 ADMIN 권한 아님");
      Logger.log("ID = "+String(session.id||""));
      Logger.log("ROLE = "+role);

      return {
        success:false,
        message:"AdminApp은 관리자(ADMIN) 계정만 사용할 수 있습니다."
      };
    }

    Logger.log("✅ AdminApp SESSION VALID");
    Logger.log("ID = "+String(session.id||""));
    Logger.log("ROLE = "+role);

    return {
      success:true,
      id:String(session.id||""),
      name:String(session.name||""),
      role:"ADMIN"
    };

  }catch(err){

    Logger.log(
      "verifyAdminAppSession ERROR : "+
      err
    );

    return {
      success:false,
      message:
        "세션 확인 오류 : "+
        (err&&err.message?err.message:err)
    };
  }
}


//==================================================
// 테스트
//==================================================

function testAdminAuth(){
  const sheet=getAdminSheet();

  return {
    success:true,
    sheet:sheet.getName(),
    rows:sheet.getLastRow(),
    columns:sheet.getLastColumn()
  };
}