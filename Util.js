//==================================================
// Util.gs
// Flower Delivery Ultimate v6
// Common Utility Engine
//==================================================



//==================================================
// Time
//==================================================


function getNow(){

    return new Date();

}



function getNowString(){


    return Utilities.formatDate(

        new Date(),

        Session.getScriptTimeZone(),

        "yyyy-MM-dd HH:mm:ss"

    );


}




//==================================================
// Cache
//==================================================


function clearProjectCache(){


    CacheService

        .getScriptCache()

        .removeAll([

            "driverData",

            "orderData"

        ]);


}





//==================================================
// Logger
//==================================================


function log(data){


    Logger.log(

        JSON.stringify(data)

    );


}




//==================================================
// Drive Image URL
//==================================================


function makeDriveImageUrl(fileId){


    if(!fileId){

        return "";

    }


    return (

        "https://drive.google.com/uc?export=view&id="

        +

        fileId

    );


}





function makePreviewUrl(fileId){


    if(!fileId){

        return "";

    }


    return (

        "https://drive.google.com/file/d/"

        +

        fileId

        +

        "/view"

    );


}





//==================================================
// File ID Extract
//==================================================


function getFileId(url){

    if(!url){
        return "";
    }

    const urlStr = String(url);
    
    // 1. /file/d/{id}/view 구조 파싱
    if (urlStr.indexOf("/file/d/") > -1) {
        const dMatch = urlStr.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (dMatch && dMatch[1]) {
            return dMatch[1];
        }
    }

    // 2. id={id} 쿼리 스트링 구조 파싱
    const match = urlStr.match(/id=([a-zA-Z0-9_-]+)/);

    if(match && match[1]){
        return match[1];
    }

    return "";
}

//==================================================
// Phone Link
//==================================================


function callLink(phone){


    if(!phone){

        return "";

    }


    return "tel:" + phone;


}





//==================================================
// Route Status Generator
//==================================================


function createRouteStatus(route){


    if(!route){

        return "";

    }



    const count =

        String(route)

        .split("➡️")

        .length;



    const result=[];



    for(
        let i=0;
        i<count;
        i++
    ){

        result.push(

            "미픽업"

        );

    }



    return result.join(",");


}





//==================================================
// Order ID Generator
//==================================================


function generateOrderId(){


    while(true){



        const now = new Date();



        const datePart =

            Utilities.formatDate(

                now,

                "Asia/Seoul",

                "yyMMdd"

            );



        const chars =

            "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";



        let random="";



        for(
            let i=0;
            i<6;
            i++
        ){


            random +=

                chars.charAt(

                    Math.floor(

                        Math.random()

                        *

                        chars.length

                    )

                );


        }




        const id =

            "OD"

            +

            datePart

            +

            "-"

            +

            random;





        if(

            !findOrderRow(id)

        ){

            return id;

        }



    }


}





//==================================================
// Upload File Name
//==================================================


function generateUploadFileName(

    orderId,

    index,

    originalName

){



    let ext="";



    if(originalName){


        const pos =

            originalName.lastIndexOf(".");


        if(pos>-1){

            ext =

                originalName.substring(pos);

        }


    }





    return (

        orderId

        +

        "_"

        +

        (index+1)

        +

        ext

    );


}





//==================================================
// Safe String
//==================================================


function safeString(value){


    if(value===null ||

       value===undefined

    ){

        return "";

    }


    return String(value).trim();


}





//==================================================
// Safe Number
//==================================================


function safeNumber(value){


    const n = Number(value);



    if(isNaN(n)){

        return 0;

    }


    return n;


}





//==================================================
// Array Check
//==================================================


function isArray(value){


    return Array.isArray(value);


}





//==================================================
// JSON Safe Parse
//==================================================


function safeJsonParse(data){


    try{


        return JSON.parse(data);



    }catch(e){


        return null;


    }


}





//==================================================
// JSON Safe Stringify
//==================================================


function safeJsonStringify(data){


    try{


        return JSON.stringify(data);



    }catch(e){


        return "{}";


    }


}

// Supabase 오더 조회 공통: 엑셀 내역도 오더 원본은 Supabase만 사용
function getExcelOrdersFromSupabase_(){
  const result=getSupabaseOrdersResult();
  if(!result||result.success!==true||!Array.isArray(result.data)){
    const message=result&&result.error?result.error:"Supabase 조회 결과가 올바르지 않습니다.";
    throw new Error("Supabase 오더 조회 실패: "+message);
  }
  return result.data;
}
function excelKstDate_(value){
  if(value===null||value===undefined||value==="")return "";
  const d=value instanceof Date?value:new Date(value);
  return isNaN(d.getTime())?"":Utilities.formatDate(d,"Asia/Seoul","yyyy-MM-dd");
}
function excelKstDateTime_(value){
  if(value===null||value===undefined||value==="")return "";
  const d=value instanceof Date?value:new Date(value);
  return isNaN(d.getTime())?String(value):Utilities.formatDate(d,"Asia/Seoul","yyyy-MM-dd HH:mm:ss");
}
function excelDateInRange_(value,startDateStr,endDateStr){
  const day=excelKstDate_(value);
  return !!day&&(!startDateStr||day>=String(startDateStr).slice(0,10))&&(!endDateStr||day<=String(endDateStr).slice(0,10));
}
function excelRouteText_(value){
  if(!value)return "";
  try{const parsed=typeof value==="string"&&value.trim().startsWith("[")?JSON.parse(value):value;return Array.isArray(parsed)?parsed.join(" ➡️ "):String(parsed);}catch(e){return String(value);}
}
function excelDriverName_(driverId){
  const ids=String(driverId||"").split(",").map(function(v){return v.trim();}).filter(Boolean);
  return ids.map(function(id){try{const info=findDriverRow(id);return info&&info.data&&typeof DRIVER_COL!=="undefined"?String(info.data[DRIVER_COL.NAME]||id):id;}catch(e){return id;}}).join(", ");
}

//==================================================
// 마스터 / 부마스터 공용
// 전체 기사 배송내역 Excel 생성
//==================================================
function createAllDriversOrdersExcel(startDateStr,endDateStr){
  let tempSS=null;
  try{
    const data=getExcelOrdersFromSupabase_();
    const rows=[["오더ID","상품명","배송경로","기사ID","기사명","등록시간"]];
    data.forEach(function(order){
      if(!order||!excelDateInRange_(order.created_at||order.register,startDateStr,endDateStr))return;
      const driverId=String(order.driver_id||"").trim();
      rows.push([String(order.order_id||""),String(order.product||""),excelRouteText_(order.route),driverId,excelDriverName_(driverId),excelKstDateTime_(order.created_at||order.register)]);
    });
    if(rows.length<=1)return "ERROR: 해당 기간에 오더 내역이 없습니다.";
    tempSS=SpreadsheetApp.create("부름이_전체기사_임시_"+Date.now());
    const sh=tempSS.getSheets()[0];
    sh.getRange(1,1,rows.length,6).setValues(rows);
    sh.getRange(1,1,1,6).setFontWeight("bold");
    sh.setFrozenRows(1);sh.autoResizeColumns(1,6);SpreadsheetApp.flush();
    const response=UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/"+tempSS.getId()+"/export?format=xlsx",{headers:{Authorization:"Bearer "+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
    if(response.getResponseCode()!==200)return "ERROR: Excel 파일 생성 실패 ("+response.getResponseCode()+")";
    return {fileName:"부름이_전체기사_"+startDateStr+"_"+endDateStr+".xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",base64:Utilities.base64Encode(response.getBlob().getBytes())};
  }catch(err){Logger.log("createAllDriversOrdersExcel Error: "+err.message);return "ERROR: "+err.message;}
  finally{if(tempSS){try{DriveApp.getFileById(tempSS.getId()).setTrashed(true);}catch(e){Logger.log("임시 엑셀 정리 실패: "+e.message);}}}
}

//==================================================
// 부마스터 및 마스터 공용: 배송완료일 기준 엑셀 다운로드용 데이터 조회
//==================================================
function fetchOrdersForExcel(startDateStr,endDateStr){
  try{
    const data=getExcelOrdersFromSupabase_();
    const result=[];
    data.forEach(function(order){
      if(!order)return;
      const completed=order.completed_time;
      if(!completed||!excelDateInRange_(completed,startDateStr,endDateStr))return;
      const driverId=String(order.driver_id||"").trim();
      result.push({id:String(order.order_id||""),productName:String(order.product||""),route:excelRouteText_(order.route),driverName:excelDriverName_(driverId),regTime:excelKstDateTime_(completed),status:String(order.status||"배송완료"),deliveryTime:excelKstDateTime_(completed)});
    });
    Logger.log("Supabase 배송완료일 기준 엑셀 조회: "+result.length+"건");
    return result;
  }catch(err){Logger.log("fetchOrdersForExcel 오류: "+err.message);return "ERROR_MSG: "+err.message;}
}

//==================================================
// 기사 앱 전용: 특정 기사 배송 내역 엑셀 데이터 조회 (D열 기사ID 반영)
//==================================================
function fetchDriverOrdersForExcel(driverId,startDateStr,endDateStr){
  try{
    driverId=String(driverId||"").trim();
    if(!driverId)return "ERROR_MSG: 기사 ID가 없습니다.";
    const data=getExcelOrdersFromSupabase_();
    const result=[];
    data.forEach(function(order){
      if(!order||!order.completed_time)return;
      const assigned=String(order.driver_id||"").split(",").map(function(v){return v.trim();});
      if(assigned.indexOf(driverId)<0||!excelDateInRange_(order.completed_time,startDateStr,endDateStr))return;
      result.push({id:String(order.order_id||""),productName:String(order.product||""),route:excelRouteText_(order.route),driverId:String(order.driver_id||""),regTime:excelKstDateTime_(order.completed_time),deliveryTime:excelKstDateTime_(order.completed_time),status:String(order.status||"배송완료")});
    });
    return result;
  }catch(err){Logger.log("fetchDriverOrdersForExcel 오류: "+err.message);return "ERROR_MSG: "+err.message;}
}

function createDriverOrdersExcel(driverId,startDateStr,endDateStr){
  let tempSS=null;
  try{
    driverId=String(driverId||"").trim();
    if(!driverId)return "ERROR: 기사 ID가 없습니다.";
    const data=getExcelOrdersFromSupabase_();
    const rows=[["오더ID","상품명","경로","기사ID","배송완료시간"]];
    data.forEach(function(order){
      if(!order||!order.completed_time)return;
      const assigned=String(order.driver_id||"").split(",").map(function(v){return v.trim();});
      if(assigned.indexOf(driverId)<0||!excelDateInRange_(order.completed_time,startDateStr,endDateStr))return;
      rows.push([String(order.order_id||""),String(order.product||""),excelRouteText_(order.route),String(order.driver_id||""),excelKstDateTime_(order.completed_time)]);
    });
    if(rows.length<=1)return "ERROR: 해당 기간에 배송완료 내역이 없습니다.";
    tempSS=SpreadsheetApp.create("부름이_임시_엑셀_"+Date.now());
    const sh=tempSS.getSheets()[0];
    sh.getRange(1,1,rows.length,5).setValues(rows);
    sh.getRange(1,1,1,5).setFontWeight("bold");sh.setFrozenRows(1);sh.autoResizeColumns(1,5);SpreadsheetApp.flush();
    const response=UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/"+tempSS.getId()+"/export?format=xlsx",{headers:{Authorization:"Bearer "+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
    if(response.getResponseCode()!==200)return "ERROR: Excel 파일 생성 실패 ("+response.getResponseCode()+")";
    return {fileName:"부름이_"+driverId+"_"+startDateStr+"_"+endDateStr+".xlsx",mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",base64:Utilities.base64Encode(response.getBlob().getBytes())};
  }catch(err){Logger.log("createDriverOrdersExcel 오류: "+err.message);return "ERROR: "+err.message;}
  finally{if(tempSS){try{DriveApp.getFileById(tempSS.getId()).setTrashed(true);}catch(e){Logger.log("임시 엑셀 정리 실패: "+e.message);}}}
}

function getDashboardSummaryServer() {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("오더시트이름"); // 👉 실제 시트 이름으로 변경하세요
    var data = sheet.getDataRange().getValues();
    
    var total = data.length - 1; // 헤더 제외
    if (total < 0) total = 0;
    
    var uncheck = 0, ing = 0, done = 0, reject = 0;

    // 데이터 행을 돌면서 상태 카운트 (기존에 쓰시던 조건 그대로 적용)
    for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var status = "";
        
        // 상태값이 들어있는 열 번호에 맞게 조절 (예: 5번째 열이 상태라면 row[4] 등)
        // 여기서는 기존 로직과 유사하게 행 전체 문자열 검사 혹은 특정 열 검사 수행
        var rowStr = row.join(" ");
        
        if (rowStr.indexOf("거절") !== -1 || rowStr.indexOf("취소") !== -1) {
            reject++;
        } else if (rowStr.indexOf("배송완료") !== -1 || rowStr.indexOf("완료") !== -1) {
            done++;
        } else if (rowStr.indexOf("수락") !== -1 || rowStr.indexOf("배송중") !== -1 || rowStr.indexOf("픽업") !== -1) {
            ing++;
        } else {
            uncheck++;
        }
    }

    return {
        total: total,
        uncheck: uncheck,
        ing: ing,
        done: done,
        reject: reject
    };
}

// 안드로이드로부터 전달받은 드라이버 ID와 토큰을 시트에 저장하는 함수
function saveDriverTokenToSheet(driverId, fcmToken) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Drivers"); // 드라이버 정보가 있는 시트 이름 (맞게 수정)
  
  if (!sheet) {
    return "시트를 찾을 수 없습니다.";
  }
  
  var data = sheet.getDataRange().getValues();
  var found = false;
  
  // 이미 등록된 드라이버라면 토큰만 업데이트, 없으면 새로 추가 등 로직 구현
  for (var i = 1; i < data.length; i++) {
    // 예시: A열이 DriverID, B열 혹은 새로운 컬럼에 FCM 토큰을 저장한다고 가정
    if (data[i][0] == driverId) { 
      sheet.getRange(i + 1, 3).setValue(fcmToken); // C열(3번째 열)에 토큰 저장 예시
      found = true;
      break;
    }
  }
  
  return "토큰 저장 완료";
}

//==================================================
// FCM 단독 테스트
// 기사ID: oflower
//==================================================
function testFcmToOfLower() {

  const driverId = "oflower";

  const orderId =
    "TEST-" + new Date().getTime();

  const routeText =
    "📍 서울 강남구 테헤란로 123 ➡️ 서울 송파구 올림픽로 300";

  const pushBody =
    "🆔 주문번호: " + orderId +
    "\n" +
    "📍 경로: " + routeText +
    "\n" +
    "📦 테스트 배송";

  Logger.log("========================================");
  Logger.log("[FCM TEST] 시작");
  Logger.log("[FCM TEST] 기사ID = " + driverId);
  Logger.log("[FCM TEST] orderId = " + orderId);
  Logger.log("[FCM TEST] pushBody = " + pushBody);

  const result =
    sendFcmPushToDriver(
      driverId,
      "📦 FCM 테스트 오더",
      pushBody,
      {
        orderId: orderId,
        type: "NEW_ORDER",
        timestamp: String(Date.now())
      }
    );

  Logger.log("[FCM TEST] 결과 = " + result);
  Logger.log("========================================");

  return result;
}

//==================================================
// 🇰🇷 한국시간(KST) 공통 시간 표시 함수
// Supabase UTC / Google Sheet Date 모두 한국시간으로 표시
//==================================================
function formatKoreanDateTime(value){
    if(value===null||value===undefined||value==="")return "";
    try{
        var d=value instanceof Date?value:new Date(value);
        if(isNaN(d.getTime()))return String(value);
        return Utilities.formatDate(d,"Asia/Seoul","yyyy-MM-dd HH:mm:ss");
    }catch(e){
        Logger.log("formatKoreanDateTime 오류: "+e.toString());
        return String(value||"");
    }
}

function formatKoreanDate(value){
    if(value===null||value===undefined||value==="")return "";
    try{
        var d=value instanceof Date?value:new Date(value);
        if(isNaN(d.getTime()))return String(value);
        return Utilities.formatDate(d,"Asia/Seoul","yyyy-MM-dd");
    }catch(e){
        return String(value||"");
    }
}

function formatKoreanTime(value){
    if(value===null||value===undefined||value==="")return "";
    try{
        var d=value instanceof Date?value:new Date(value);
        if(isNaN(d.getTime()))return String(value);
        return Utilities.formatDate(d,"Asia/Seoul","HH:mm:ss");
    }catch(e){
        return String(value||"");
    }
}

//==================================================
// System Check
//==================================================
Logger.log(
    "UTIL ENGINE ULTIMATE v7 READY"
);