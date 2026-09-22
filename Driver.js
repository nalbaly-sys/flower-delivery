//==================================================
// Driver.gs
// Flower Delivery Ultimate
// Driver Management Engine
//==================================================

function getDriverList(){
  try{
    var data=typeof getDriverData==="function"?getDriverData():[];
    if(!data||!Array.isArray(data)||data.length===0)return JSON.stringify([]);
    var list=[];
    for(var i=1;i<data.length;i++){
      var row=data[i];
      if(!row||!row[DRIVER_COL.ID])continue;
      var latVal=Number(row[DRIVER_COL.LAT]);
      var lngVal=Number(row[DRIVER_COL.LNG]);
      list.push({
        id:String(row[DRIVER_COL.ID]||"").trim(),
        name:String(row[DRIVER_COL.NAME]||"").trim(),
        phone:String(row[DRIVER_COL.PHONE]||"").trim(),
        status:String(row[DRIVER_COL.STATUS]||"퇴근함").trim(),
        lat:isNaN(latVal)?0:latVal,
        lng:isNaN(lngVal)?0:lngVal,
        time:String(row[DRIVER_COL.GPS_TIME]||"")
      });
    }
    return JSON.stringify(list);
  }catch(err){
    Logger.log("SERVER ERROR in getDriverList: "+err.toString());
    return JSON.stringify([]);
  }
}

function getDriverGpsDirectForMap(){
  var cache=CacheService.getScriptCache();
  var cachedData=cache.get("DRIVER_GPS_LIVE");
  if(cachedData)return cachedData;
  return getDriverList();
}

function updateDriverStatus(driverId,status){
  try{
    driverId=String(driverId||"").trim();
    status=String(status||"").trim();
    if(!driverId)throw new Error("기사 ID가 없습니다.");
    if(!status)throw new Error("근무상태가 없습니다.");
    var sheet=getDriverSheet();
    if(!sheet)throw new Error("기사상태_DB 시트를 찾을 수 없습니다.");
    var lastRow=sheet.getLastRow();
    if(lastRow<2)throw new Error("기사상태_DB에 기사 데이터가 없습니다.");
    var data=sheet.getRange(2,1,lastRow-1,Math.max(10,sheet.getLastColumn())).getValues();
    var foundRow=-1;
    for(var i=0;i<data.length;i++){
      if(String(data[i][DRIVER_COL.ID]||"").trim()===driverId){
        foundRow=i+2;
        break;
      }
    }
    if(foundRow===-1)throw new Error("해당 기사를 찾을 수 없습니다: "+driverId);
    sheet.getRange(foundRow,DRIVER_COL.STATUS+1).setValue(status);
    sheet.getRange(foundRow,DRIVER_COL.LAST_ACCESS+1).setValue(new Date());
    SpreadsheetApp.flush();
    return{success:true,message:"기사 근무상태가 "+status+"로 변경되었습니다.",driverId:driverId,status:status,row:foundRow};
  }catch(error){
    Logger.log("[AUTO WORK] 오류 = "+error.toString());
    return{success:false,message:error.message||String(error)};
  }
}

function formatGPSDate(value){
  if(!value)return"-";
  try{return Utilities.formatDate(new Date(value),"Asia/Seoul","HH:mm:ss");}catch(e){return"-";}
}

function getDriversLocationData(){
  const data=getDriverData();
  const list=[];
  for(let i=1;i<data.length;i++){
    const row=data[i];
    if(String(row[DRIVER_COL.STATUS]||"").trim()!=="근무중")continue;
    const lat=Number(row[DRIVER_COL.LAT]);
    const lng=Number(row[DRIVER_COL.LNG]);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat===0||lng===0)continue;
    list.push({id:row[DRIVER_COL.ID],name:row[DRIVER_COL.NAME],status:row[DRIVER_COL.STATUS],lat:lat,lng:lng});
  }
  return JSON.stringify(list);
}

function getDriverMap(){
  const data=getDriverData();
  const map={};
  for(let i=1;i<data.length;i++){
    const id=String(data[i][DRIVER_COL.ID]||"").trim();
    if(!id)continue;
    map[id]=String(data[i][DRIVER_COL.NAME]||"");
  }
  return JSON.stringify(map);
}

//==================================================
// 기사 GPS 업데이트
//==================================================
function updateDriverLocation(driverId,lat,lng){
  Logger.log("========== GPS ==========");
  Logger.log("driverId="+driverId);
  Logger.log("lat="+lat);
  Logger.log("lng="+lng);
  try{
    const sheet=getDriverSheet();
    if(!sheet){
      Logger.log("에러: 기사 시트를 찾을 수 없음");
      return false;
    }
    const driver=findDriverRow(driverId);
    Logger.log("driver="+JSON.stringify(driver));
    if(!driver){
      Logger.log("에러: 시트에서 기사 ID를 찾지 못함 -> "+driverId);
      return false;
    }
    const latitude=Number(lat);
    const longitude=Number(lng);
    if(!Number.isFinite(latitude)||!Number.isFinite(longitude)){
      Logger.log("에러: 잘못된 GPS 좌표");
      return false;
    }
    sheet.getRange(driver.row,DRIVER_COL.LAT+1).setValue(latitude);
    sheet.getRange(driver.row,DRIVER_COL.LNG+1).setValue(longitude);
    sheet.getRange(driver.row,DRIVER_COL.GPS_TIME+1).setValue(new Date());
    try{
      CacheService.getScriptCache().remove("DRIVER_GPS_LIVE");
    }catch(cacheErr){
      Logger.log("캐시 삭제 무시: "+cacheErr.toString());
    }
    Logger.log("성공: 기사("+driverId+") 위치 시트 작성 완료 (행: "+driver.row+")");
    return true;
  }catch(err){
    Logger.log("updateDriverLocation 치명적 에러: "+err.toString());
    return false;
  }
}

function setDriverWorkStatus(driverId,status){
  const lock=LockService.getScriptLock();
  try{
    lock.waitLock(5000);
    const sheet=getDriverSheet();
    const driver=findDriverRow(driverId);
    if(!driver)return{success:false,message:"기사를 찾을 수 없습니다."};
    sheet.getRange(driver.row,DRIVER_COL.STATUS+1).setValue(status);
    sheet.getRange(driver.row,DRIVER_COL.LAST_ACCESS+1).setValue(new Date());
    if(typeof clearProjectCache==="function")clearProjectCache();
    return{success:true,status:status};
  }finally{
    try{lock.releaseLock();}catch(e){}
  }
}

function getIndividualDriverStatus(driverId){
  const driver=findDriverRow(driverId);
  if(!driver||!Array.isArray(driver.data))return"퇴근함";
  return String(driver.data[DRIVER_COL.STATUS]||"퇴근함");
}

function getDriverName(driverId){
  const driver=findDriverRow(driverId);
  if(!driver||!Array.isArray(driver.data))return driverId;
  return String(driver.data[DRIVER_COL.NAME]||driverId);
}

function registerDriver(id,name,phone,password){
  const sheet=getDriverSheet();
  if(!sheet)return{success:false,message:"기사 DB를 찾을 수 없습니다."};
  id=String(id||"").trim();
  name=String(name||"").trim();
  phone=String(phone||"").trim();
  password=String(password||"").trim();
  if(findDriverRow(id))return{success:false,message:"이미 등록된 ID입니다."};
  const newRow=[];
  newRow[DRIVER_COL.ID]=id;
  newRow[DRIVER_COL.NAME]=name;
  newRow[DRIVER_COL.PHONE]=phone;
  newRow[DRIVER_COL.STATUS]="근무중";
  newRow[DRIVER_COL.LAST_ACCESS]=new Date();
  newRow[DRIVER_COL.LAT]="";
  newRow[DRIVER_COL.LNG]="";
  newRow[DRIVER_COL.GPS_TIME]="";
  newRow[DRIVER_COL.PASSWORD]=password;
  newRow[DRIVER_COL.FCM_TOKEN]="";
  sheet.appendRow(newRow);
  const link=ScriptApp.getService().getUrl()+"?page=driver&driverId="+encodeURIComponent(id);
  if(typeof clearProjectCache==="function")clearProjectCache();
  return{success:true,message:"기사 등록 완료",driverLink:link};
}

function getDriverPhone(driverId){
  const driver=findDriverRow(driverId);
  if(!driver||!Array.isArray(driver.data))return"";
  return String(driver.data[DRIVER_COL.PHONE]||"");
}

function renderDriverBoard(data){
  let drivers=data;
  if(typeof drivers==="string"){
    try{drivers=JSON.parse(drivers);}catch(e){drivers=[];}
  }
  if(!Array.isArray(drivers))drivers=[];
  drivers.forEach(function(driver){});
}

//==================================================
// 기사 FCM Token 저장
// 기사상태_DB J열
//==================================================
function saveDriverTokenToSheet(driverId,fcmToken){
  const lock=LockService.getScriptLock();
  try{
    lock.waitLock(5000);
    driverId=String(driverId||"").trim();
    fcmToken=String(fcmToken||"").trim();
    if(!driverId)return{success:false,message:"기사 ID가 없습니다."};
    if(!fcmToken)return{success:false,message:"FCM 토큰이 없습니다."};
    const sheet=getDriverSheet();
    if(!sheet)return{success:false,message:"기사상태_DB를 찾을 수 없습니다."};
    const driver=findDriverRow(driverId);
    if(!driver)return{success:false,message:"기사를 찾을 수 없습니다."};
    const FCM_TOKEN_COL=DRIVER_COL.FCM_TOKEN+1;
    sheet.getRange(driver.row,FCM_TOKEN_COL).setValue(fcmToken);
    SpreadsheetApp.flush();
    const savedToken=String(sheet.getRange(driver.row,FCM_TOKEN_COL).getValue()||"").trim();
    Logger.log("📡 기사 FCM Token 저장 = "+driverId+" / J열 / 길이="+savedToken.length);
    return{success:savedToken===fcmToken,message:savedToken===fcmToken?"FCM 토큰 저장 완료":"FCM 토큰 저장 확인 실패",driverId:driverId};
  }catch(err){
    Logger.log("❌ saveDriverTokenToSheet 오류 = "+err.toString());
    return{success:false,message:err.toString()};
  }finally{
    try{lock.releaseLock();}catch(e){}
  }
}

Logger.log("DRIVER ENGINE ULTIMATE READY");