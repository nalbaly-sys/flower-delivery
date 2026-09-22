//==================================================
// Common.gs
// Flower Delivery Ultimate
// Database Core Engine
//==================================================

const DRIVER_SHEET_NAME="기사상태_DB";
const ORDER_SHEET_NAME="오더_DB";
const UPLOAD_FOLDER_ID="1Nm1EWX4zuO7fFLDcanWpWeUtZJc6WOzf";

const DRIVER_COL={ID:0,NAME:1,PHONE:2,STATUS:3,LAST_ACCESS:4,LAT:5,LNG:6,GPS_TIME:7,PASSWORD:8,FCM_TOKEN:9};

const ORDER_COL={ORDER_ID:0,REGISTER:1,DATE:2,PRODUCT:3,ROUTE:4,ASSIGN_TYPE:5,DRIVER_ID:6,STATUS:7,IMAGE:8,THUMB:9,ROUTE_STATUS:10,REJECT_DRIVER:11,REJECT_TIME:12,COMPLETED_TIME:13};

function getSS(){return SpreadsheetApp.getActiveSpreadsheet();}

function getDriverSheet(){return getSS().getSheetByName(DRIVER_SHEET_NAME);}

function getOrderSheet(){return getSS().getSheetByName(ORDER_SHEET_NAME);}

function getDriverData(){const sheet=getDriverSheet();if(!sheet)return[];return sheet.getDataRange().getValues();}

function getOrderData(){const sheet=getOrderSheet();if(!sheet)return[];return sheet.getDataRange().getValues();}

function findDriverRow(driverId){
  const data=getDriverData();
  if(!data||data.length<=1)return null;
  driverId=String(driverId||"").trim();
  for(let i=1;i<data.length;i++){
    if(data[i]&&String(data[i][DRIVER_COL.ID]||"").trim()===driverId)return{row:i+1,data:data[i]};
  }
  return null;
}

function findOrderRow(orderId){
  const data=getOrderData();
  if(!data||data.length<=1)return null;
  orderId=String(orderId||"").trim();
  for(let i=1;i<data.length;i++){
    if(data[i]&&String(data[i][ORDER_COL.ORDER_ID]||"").trim()===orderId)return{row:i+1,data:data[i]};
  }
  return null;
}

function updateCell(sheet,row,col,value){
  if(!sheet)return false;
  sheet.getRange(row,col).setValue(value);
  return true;
}

function updateRow(sheet,row,startCol,values){
  if(!sheet)return false;
  sheet.getRange(row,startCol,1,values.length).setValues([values]);
  return true;
}

function insertOrder(row){
  const sheet=getOrderSheet();
  if(!sheet)return false;
  sheet.appendRow(row);
  return true;
}

function verifyDriverLogin(driverId,password){
  try{
    const sheet=getDriverSheet();
    if(!sheet)return{success:false,msg:"'기사상태_DB' 시트를 찾을 수 없습니다."};
    const data=sheet.getDataRange().getValues();
    driverId=String(driverId||"").trim();
    password=String(password||"").trim();
    for(let i=1;i<data.length;i++){
      const id=String(data[i][DRIVER_COL.ID]||"").trim();
      const pwd=String(data[i][DRIVER_COL.PASSWORD]||"").trim();
      if(id===driverId){
        if(pwd===password)return{success:true};
        return{success:false,msg:"비밀번호가 일치하지 않습니다."};
      }
    }
    return{success:false,msg:"등록되지 않은 기사 ID입니다."};
  }catch(e){
    return{success:false,msg:"로그인 서버 에러: "+e.message};
  }
}

Logger.log("COMMON ENGINE ULTIMATE READY");