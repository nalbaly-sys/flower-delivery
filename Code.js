//==================================================
// Code.gs
// Flower Delivery Ultimate
// Web App Router + Android WebHook
// 지정배차 + 재배차 전용
//==================================================

function doGet(e){
  var param=(e&&e.parameter)?e.parameter:{};
  var page=String(param.page||"").trim().toLowerCase();
  var token=String(param.token||"").trim();
  if(page==="map"){var template=HtmlService.createTemplateFromFile("map");template.FOCUS_LAT=Number(param.lat||param.focusLat||0);template.FOCUS_LNG=Number(param.lng||param.focusLng||0);return buildOutput(template.evaluate(),"실시간 관제 지도");}
  if(page==="driver")return renderDriver(e);
  if(page==="register")return renderRegister();
  if(page==="master")return renderIndex(token);
  if(page==="sub")return renderSub(token);
  return renderLogin();
}

function renderLogin(){
  var template=HtmlService.createTemplateFromFile("index");
  template.WEB_APP_URL=getWebAppUrl();
  template.ADMIN_TOKEN="";
  template.ADMIN_ID="";
  template.ADMIN_NAME="";
  template.ADMIN_ROLE="";
  template.IS_LOGGED_IN=false;
  return buildOutput(template.evaluate(),"꽃배달 관리자 로그인");
}

function renderDriver(e){
  var param=(e&&e.parameter)?e.parameter:{};
  var driverId=String(param.driverId||"").trim();
  var template=HtmlService.createTemplateFromFile("driver");
  template.SERVER_DRIVER_ID=driverId;
  template.SERVER_DRIVER_NAME=driverId;
  template.WEB_APP_URL=getWebAppUrl();
  return buildOutput(template.evaluate(),"꽃배달 기사 앱");
}

function renderIndex(token){
  var session=verifyAdminSession(token,"MASTER");
  if(!session.success)return renderLogin();
  var template=HtmlService.createTemplateFromFile("index");
  template.WEB_APP_URL=getWebAppUrl();
  template.ADMIN_TOKEN=token;
  template.ADMIN_ID=session.id;
  template.ADMIN_NAME=session.name;
  template.ADMIN_ROLE=session.role;
  return buildOutput(template.evaluate(),"꽃배달 종합 실시간 관제 시스템");
}

function getSubMasterList(token){
  var session=verifyAdminSession(token,"MASTER");
  if(!session.success)return{success:false,message:session.message};
  try{
    var sheet=getAdminSheet(),data=sheet.getDataRange().getValues(),list=[];
    for(var i=1;i<data.length;i++){
      var role=String(data[i][ADMIN_COL.ROLE]||"").trim().toUpperCase();
      if(role==="SUBMASTER")list.push({id:String(data[i][ADMIN_COL.ID]||""),name:String(data[i][ADMIN_COL.NAME]||""),status:String(data[i][ADMIN_COL.STATUS]||"")});
    }
    return{success:true,list:list};
  }catch(err){
    return{success:false,message:"부마스터 목록 조회 오류 : "+err.message};
  }
}

function renderMap(e){
  var param=(e&&e.parameter)?e.parameter:{};
  var template=HtmlService.createTemplateFromFile("map");
  template.FOCUS_LAT=Number(param.lat||param.focusLat||0);
  template.FOCUS_LNG=Number(param.lng||param.focusLng||0);
  return buildOutput(template.evaluate(),"실시간 배송 지도");
}

function renderRegister(){
  var template=HtmlService.createTemplateFromFile("register");
  template.WEB_APP_URL=getWebAppUrl();
  return buildOutput(template.evaluate(),"기사 등록");
}

function renderSub(token){
  var session=token?verifyAdminSession(token,"SUBMASTER"):{success:false};
  var template=HtmlService.createTemplateFromFile("sub");
  template.WEB_APP_URL=getWebAppUrl();
  template.ADMIN_TOKEN=session.success?token:"";
  template.ADMIN_ID=session.success?session.id:"";
  template.ADMIN_NAME=session.success?session.name:"";
  template.ADMIN_ROLE=session.success?session.role:"";
  return buildOutput(template.evaluate(),"부마스터 관제");
}

function buildOutput(output,title){
  return output.setTitle(title).addMetaTag("viewport","width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no").setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getWebAppUrl(){
  try{return ScriptApp.getService().getUrl();}catch(err){Logger.log(err);return"";}
}

function include(filename){
  filename=String(filename||"").trim();
  if(!filename)return"";
  try{return HtmlService.createHtmlOutputFromFile(filename).getContent();}catch(err){Logger.log("Include Error : "+filename+" / "+err);return"";}
}

function testSystem(){
  return{status:"OK",version:"Flower Delivery Ultimate",time:new Date()};
}

//==================================================
// 기사 FCM Token 저장
// 기사상태_DB J열
//==================================================
function saveFcmToken(driverId,token){
  try{
    Logger.log("=== saveFcmToken 서버 함수 실행됨 ===");
    driverId=String(driverId||"").trim();
    token=String(token||"").trim();
    if(!driverId)return{success:false,error:"Missing driverId"};
    if(!token)return{success:false,error:"Missing token"};
    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sheet=ss.getSheetByName("기사상태_DB");
    if(!sheet)return{success:false,error:"Sheet not found"};
    var lastRow=sheet.getLastRow();
    if(lastRow<1)return{success:false,error:"Empty sheet"};
    var idColumn=sheet.getRange(1,1,lastRow,1).getValues();
    var targetRow=-1;
    for(var i=0;i<idColumn.length;i++){
      if(String(idColumn[i][0]||"").trim()===driverId){targetRow=i+1;break;}
    }
    if(targetRow===-1)return{success:false,error:"Driver ID not found"};
    sheet.getRange(targetRow,10).setValue(token);
    SpreadsheetApp.flush();
    Logger.log("✅ 기사 FCM Token 저장 완료 = "+driverId);
    return{success:true};
  }catch(err){
    Logger.log("❌ saveFcmToken 에러: "+err.toString());
    return{success:false,error:err.toString()};
  }
}

//==================================================
// Android WebHook
// ADMIN FCM / MASTER FCM / 기사 Token / GPS
//==================================================
function doPost(e){
  try{
    if(!e||!e.postData||!e.postData.contents)return ContentService.createTextOutput(JSON.stringify({success:false,error:"POST DATA 없음"})).setMimeType(ContentService.MimeType.JSON);
    var data;
    try{data=JSON.parse(e.postData.contents);}catch(parseErr){Logger.log("❌ JSON 파싱 오류 = "+parseErr);return ContentService.createTextOutput(JSON.stringify({success:false,error:"JSON 파싱 오류"})).setMimeType(ContentService.MimeType.JSON);}
    var action=String(data.action||"").trim();
    var type=String(data.type||"").trim();
    var driverId=String(data.driverId||"").trim();
    var adminId=String(data.adminId||"").trim();
    var token=String(data.token||"").trim();

    Logger.log("========================================");
    Logger.log("📡 Android POST 수신");
    Logger.log("type = "+type);
    Logger.log("action = "+action);
    Logger.log("adminId = "+adminId);
    Logger.log("driverId = "+driverId);
    Logger.log("token = "+(token?"있음":"없음"));
    Logger.log("lat = "+data.lat);
    Logger.log("lng = "+data.lng);
    Logger.log("========================================");

    //==================================================
    // 관리자 FCM Token → 관리자계정_DB H열
    //==================================================
    if(type==="ADMIN_FCM_TOKEN"){
      if(!adminId)return ContentService.createTextOutput(JSON.stringify({success:false,error:"Admin ID 없음"})).setMimeType(ContentService.MimeType.JSON);
      if(!token)return ContentService.createTextOutput(JSON.stringify({success:false,error:"FCM Token 없음"})).setMimeType(ContentService.MimeType.JSON);
      var adminResult=saveAdminFcmToken(adminId,token);
      Logger.log("📡 saveAdminFcmToken 결과 = "+JSON.stringify(adminResult));
      return ContentService.createTextOutput(JSON.stringify(adminResult)).setMimeType(ContentService.MimeType.JSON);
    }

    //==================================================
    // MasterApp FCM Token → 관리자계정_DB I열
    //==================================================
    if(type==="MASTER_FCM_TOKEN"){
      if(!adminId)return ContentService.createTextOutput(JSON.stringify({success:false,error:"MasterApp 관리자 ID 없음"})).setMimeType(ContentService.MimeType.JSON);
      if(!token)return ContentService.createTextOutput(JSON.stringify({success:false,error:"MasterApp FCM Token 없음"})).setMimeType(ContentService.MimeType.JSON);
      var masterResult=saveMasterFcmToken(adminId,token);
      Logger.log("📡 saveMasterFcmToken 결과 = "+JSON.stringify(masterResult));
      return ContentService.createTextOutput(JSON.stringify(masterResult)).setMimeType(ContentService.MimeType.JSON);
    }

    //==================================================
    // 기사 요청
    //==================================================
    if(!driverId)return ContentService.createTextOutput(JSON.stringify({success:false,error:"Driver ID 없음"})).setMimeType(ContentService.MimeType.JSON);

    var ss=SpreadsheetApp.getActiveSpreadsheet();
    var sheet=ss.getSheetByName("기사상태_DB");
    if(!sheet)return ContentService.createTextOutput(JSON.stringify({success:false,error:"기사상태_DB 없음"})).setMimeType(ContentService.MimeType.JSON);

    var lastRow=sheet.getLastRow();
    if(lastRow<2)return ContentService.createTextOutput(JSON.stringify({success:false,error:"기사 데이터 없음"})).setMimeType(ContentService.MimeType.JSON);

    var idColumn=sheet.getRange(1,1,lastRow,1).getValues();
    var targetRow=-1;
    for(var i=1;i<idColumn.length;i++){
      if(String(idColumn[i][0]||"").trim()===driverId){targetRow=i+1;break;}
    }

    if(targetRow===-1){
      Logger.log("❌ 기사 ID 없음 = "+driverId);
      return ContentService.createTextOutput(JSON.stringify({success:false,error:"Driver ID not found",driverId:driverId})).setMimeType(ContentService.MimeType.JSON);
    }

    //==================================================
    // 기사 FCM Token → J열
    //==================================================
    if(token){
      sheet.getRange(targetRow,10).setValue(token);
      SpreadsheetApp.flush();
      Logger.log("✅ 기사 FCM Token 저장 완료 = "+driverId);
    }

    //==================================================
    // 기사 GPS → F/G/H
    //==================================================
    if(action==="updateLocation"){
      var lat=Number(data.lat);
      var lng=Number(data.lng);
      if(!Number.isFinite(lat)||!Number.isFinite(lng)){
        Logger.log("❌ 좌표값 오류 = "+data.lat+","+data.lng);
        return ContentService.createTextOutput(JSON.stringify({success:false,error:"Invalid location"})).setMimeType(ContentService.MimeType.JSON);
      }

      sheet.getRange(targetRow,6).setValue(lat);
      sheet.getRange(targetRow,7).setValue(lng);
      sheet.getRange(targetRow,8).setValue(new Date());
      SpreadsheetApp.flush();

      Logger.log("✅ 기사 좌표 저장 완료 = "+driverId+" / "+lat+","+lng);

      return ContentService.createTextOutput(JSON.stringify({success:true,action:"updateLocation",driverId:driverId,lat:lat,lng:lng,row:targetRow})).setMimeType(ContentService.MimeType.JSON);
    }

    //==================================================
    // Token 저장만 요청
    //==================================================
    if(token)return ContentService.createTextOutput(JSON.stringify({success:true,action:"saveToken",driverId:driverId})).setMimeType(ContentService.MimeType.JSON);

    Logger.log("⚠️ 처리되지 않은 action = "+action);
    return ContentService.createTextOutput(JSON.stringify({success:false,error:"Unknown action",action:action})).setMimeType(ContentService.MimeType.JSON);

  }catch(err){
    Logger.log("❌ doPost 오류 = "+err.toString());
    return ContentService.createTextOutput(JSON.stringify({success:false,error:err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}