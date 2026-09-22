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

//==================================================
// 마스터 / 부마스터 공용
// 전체 기사 배송내역 Excel 생성
//==================================================
function createAllDriversOrdersExcel(startDateStr,endDateStr){
  try{
    const orderSheet=getOrderSheet();
    if(!orderSheet)return "ERROR: 오더 시트를 찾을 수 없습니다.";

    const data=orderSheet.getDataRange().getValues();
    if(!data||data.length<=1)return "ERROR: 배송 내역이 없습니다.";

    const startDate=new Date(startDateStr);
    startDate.setHours(0,0,0,0);

    const endDate=new Date(endDateStr);
    endDate.setHours(23,59,59,999);

    const cId=0,cDate=2,cProd=3,cRoute=4,cDriver=6;

    // 기사 DB
    const driverSheet=SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName("기사상태_DB");

    const driverMap={};

    if(driverSheet){
      const driverData=driverSheet.getDataRange().getValues();

      for(let i=1;i<driverData.length;i++){
        const driverId=String(driverData[i][0]||"").trim();
        const driverName=String(driverData[i][1]||"").trim();

        if(driverId){
          driverMap[driverId]=driverName;
        }
      }
    }

    const rows=[
      ["오더ID","상품명","배송경로","기사ID","기사명","등록시간"]
    ];

    for(let i=1;i<data.length;i++){
      const row=data[i];

      const rowDateVal=row[cDate];
      const rowDriver=String(row[cDriver]||"").trim();

      if(!rowDateVal)continue;

      const rowDate=new Date(rowDateVal);

      if(rowDate<startDate||rowDate>endDate)continue;

      let driverName="";

      if(rowDriver){
        const driverIds=rowDriver
          .split(",")
          .map(v=>v.trim())
          .filter(Boolean);

        driverName=driverIds
          .map(id=>driverMap[id]||"")
          .filter(Boolean)
          .join(", ");
      }

      rows.push([
        String(row[cId]||""),
        String(row[cProd]||""),
        String(row[cRoute]||""),
        rowDriver,
        driverName,
        String(row[cDate]||"")
      ]);
    }

    if(rows.length<=1){
      return "ERROR: 해당 기간에 배송 내역이 없습니다.";
    }

    const tempSS=SpreadsheetApp.create(
      "부름이_전체기사_임시_"+Date.now()
    );

    const tempSheet=tempSS.getSheets()[0];

    tempSheet
      .getRange(1,1,rows.length,6)
      .setValues(rows);

    tempSheet
      .getRange(1,1,1,6)
      .setFontWeight("bold");

    tempSheet.setFrozenRows(1);
    tempSheet.autoResizeColumns(1,6);

    SpreadsheetApp.flush();

    const exportUrl=
      "https://docs.google.com/spreadsheets/d/"+
      tempSS.getId()+
      "/export?format=xlsx";

    const response=UrlFetchApp.fetch(exportUrl,{
      headers:{
        Authorization:"Bearer "+ScriptApp.getOAuthToken()
      },
      muteHttpExceptions:true
    });

    const tempFile=DriveApp.getFileById(tempSS.getId());

    if(response.getResponseCode()!==200){
      tempFile.setTrashed(true);
      return "ERROR: Excel 파일 생성 실패 ("+
        response.getResponseCode()+")";
    }

    const fileName=
      "부름이_전체기사_"+
      startDateStr+
      "_"+
      endDateStr+
      ".xlsx";

    const result={
      fileName:fileName,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64:
        Utilities.base64Encode(
          response.getBlob().getBytes()
        )
    };

    tempFile.setTrashed(true);

    return result;

  }catch(err){
    Logger.log(
      "createAllDriversOrdersExcel Error: "+
      err.message
    );

    return "ERROR: "+err.message;
  }
}

//==================================================
// 부마스터 및 마스터 공용: 배송완료일 기준 엑셀 다운로드용 데이터 조회
//==================================================
function fetchOrdersForExcel(startDateStr,endDateStr){
    try{
        const sheet=getOrderSheet();
        if(!sheet)return "ERROR: 오더 시트를 찾을 수 없습니다.";

        const data=sheet.getDataRange().getValues();
        if(!data||data.length<=1)return[];

        const startDate=new Date(startDateStr);
        startDate.setHours(0,0,0,0);

        const endDate=new Date(endDateStr);
        endDate.setHours(23,59,59,999);

        const cId=0;
        const cProd=3;
        const cRoute=4;
        const cDriver=6;
        const cStatus=7;
        const cCompletedDate=13;

        let resultList=[];

        for(let i=1;i<data.length;i++){
            const row=data[i];
            const completedDateVal=row[cCompletedDate];

            if(!completedDateVal)continue;

            const completedDate=new Date(completedDateVal);

            if(isNaN(completedDate.getTime()))continue;

            if(completedDate>=startDate&&completedDate<=endDate){
                resultList.push({
                    id:String(row[cId]||""),
                    productName:String(row[cProd]||""),
                    route:String(row[cRoute]||""),
                    driverName:String(row[cDriver]||""),
                    regTime:String(completedDateVal||""),
                    status:String(row[cStatus]||"배송완료"),
                    deliveryTime:String(completedDateVal||"")
                });
            }
        }

        return resultList;

    }catch(err){
        Logger.log("fetchOrdersForExcel Error: "+err.message);
        return "ERROR: "+err.message;
    }
}

//==================================================
// 기사 앱 전용: 특정 기사 배송 내역 엑셀 데이터 조회 (D열 기사ID 반영)
//==================================================
function fetchDriverOrdersForExcel(driverId, startDateStr, endDateStr) {
    try {
        const sheet = getOrderSheet();
        if (!sheet) return "ERROR: 오더 시트를 찾을 수 없습니다.";

        const data = sheet.getDataRange().getValues();
        if (!data || data.length <= 1) return [];

        const startDate = new Date(startDateStr);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(endDateStr);
        endDate.setHours(23, 59, 59, 999);

        // Common.gs의 ORDER_COL 기준 인덱스
        const cId = 0;      // ORDER_ID
        const cDate = 2;    // DATE (등록시간)
        const cProd = 3;    // PRODUCT
        const cRoute = 4;   // ROUTE
        const cDriver = 6;  // DRIVER_ID

        let resultList = [];

        for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const rowDriver = String(row[cDriver] || "").trim();
            const rowDateVal = row[cDate];

            if (rowDriver.includes(driverId) && rowDateVal) {
                const rowDate = new Date(rowDateVal);
                if (rowDate >= startDate && rowDate <= endDate) {
                    resultList.push({
                        id: String(row[cId] || ""),
                        productName: String(row[cProd] || ""),
                        route: String(row[cRoute] || ""),
                        driverId: String(row[cDriver] || ""), // 💡 기사ID 추가
                        regTime: String(row[cDate] || "")
                    });
                }
            }
        }
        return resultList;
    } catch (err) {
        return "ERROR: " + err.message;
    }
}

function createDriverOrdersExcel(driverId,startDateStr,endDateStr){
  try{
    const sheet=getOrderSheet();
    if(!sheet)return "ERROR: 오더 시트를 찾을 수 없습니다.";

    const data=sheet.getDataRange().getValues();
    if(!data||data.length<=1)return "ERROR: 배송 내역이 없습니다.";

    const startDate=new Date(startDateStr);
    startDate.setHours(0,0,0,0);

    const endDate=new Date(endDateStr);
    endDate.setHours(23,59,59,999);

    const cId=0;
    const cProd=3;
    const cRoute=4;
    const cDriver=6;
    const cCompletedDate=13;

    const rows=[["오더ID","상품명","경로","기사ID","배송완료시간"]];

    for(let i=1;i<data.length;i++){
      const row=data[i];

      const rowDriver=String(row[cDriver]||"").trim();
      const completedDateVal=row[cCompletedDate];

      if(!rowDriver.includes(driverId)||!completedDateVal)continue;

      const completedDate=new Date(completedDateVal);

      if(isNaN(completedDate.getTime()))continue;

      if(completedDate>=startDate&&completedDate<=endDate){
        rows.push([
          String(row[cId]||""),
          String(row[cProd]||""),
          String(row[cRoute]||""),
          String(row[cDriver]||""),
          String(completedDateVal||"")
        ]);
      }
    }

    if(rows.length<=1)return "ERROR: 해당 기간에 배송완료 내역이 없습니다.";

    const tempSS=SpreadsheetApp.create("부름이_임시_엑셀");
    const tempSheet=tempSS.getSheets()[0];

    tempSheet.getRange(1,1,rows.length,5).setValues(rows);
    tempSheet.getRange(1,1,1,5).setFontWeight("bold");
    tempSheet.autoResizeColumns(1,5);

    SpreadsheetApp.flush();

    const exportUrl="https://docs.google.com/spreadsheets/d/"+tempSS.getId()+"/export?format=xlsx";

    const response=UrlFetchApp.fetch(exportUrl,{
      headers:{
        Authorization:"Bearer "+ScriptApp.getOAuthToken()
      },
      muteHttpExceptions:true
    });

    const tempFile=DriveApp.getFileById(tempSS.getId());
    tempFile.setTrashed(true);

    if(response.getResponseCode()!==200){
      return "ERROR: Excel 파일 생성 실패 ("+response.getResponseCode()+")";
    }

    return{
      fileName:"부름이_"+driverId+"_"+startDateStr+"_"+endDateStr+".xlsx",
      mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64:Utilities.base64Encode(response.getBlob().getBytes())
    };

  }catch(err){
    return "ERROR: "+err.message;
  }
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