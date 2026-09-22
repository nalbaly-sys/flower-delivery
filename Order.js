//==================================================
// Order.gs
// Flower Delivery Ultimate v7
// Order Management Engine + Admin FCM
//==================================================

const ENABLE_FLEETING_DISPATCH=false; //선착선 사용 여부 true(사용함:function acceptFleetingOrder) false(사용안함:function acceptOrder)


function addCompositeOrder(productName,routeArray,uploadFiles,assignType,targetDriverId){
    try{
        productName=String(productName||"복합 배송").trim();
        routeArray=Array.isArray(routeArray)?routeArray:[];
        uploadFiles=Array.isArray(uploadFiles)?uploadFiles:[];
        assignType=String(assignType||"지정배차").trim();
        targetDriverId=String(targetDriverId||"").trim();

        Logger.log("===== FCM 기사 배정값 확인 =====");
        Logger.log("productName = "+productName);
        Logger.log("assignType = ["+assignType+"]");
        Logger.log("targetDriverId = ["+targetDriverId+"]");
        Logger.log("routeArray = "+JSON.stringify(routeArray));
        Logger.log("uploadFiles count = "+uploadFiles.length);
        Logger.log("================================");

        if(routeArray.length===0)return{success:false,message:"배송지가 없습니다. 배송지를 추가해주세요."};

        const orderId=typeof generateOrderId==="function"?generateOrderId():"ORD-"+new Date().getTime();
        const imageUrls=[];
        const thumbUrls=[];

        if(uploadFiles.length>0&&typeof UPLOAD_FOLDER_ID!=="undefined"){
            const folder=DriveApp.getFolderById(UPLOAD_FOLDER_ID);
            uploadFiles.forEach(function(file,index){
                try{
                    if(file&&file.base64){
                        const decodedBytes=Utilities.base64Decode(file.base64);
                        const blob=Utilities.newBlob(decodedBytes,file.mime||"image/jpeg",file.name||("image_"+index+".jpg"));
                        const fileName=typeof generateUploadFileName==="function"?generateUploadFileName(orderId,index,file.name):(orderId+"_"+index+"_"+(file.name||"file.jpg"));
                        blob.setName(fileName);
                        const driveFile=folder.createFile(blob);
                        const fileId=driveFile.getId();
                        imageUrls.push(typeof makeDriveImageUrl==="function"?makeDriveImageUrl(fileId):fileId);
                        thumbUrls.push(typeof makePreviewUrl==="function"?makePreviewUrl(fileId):fileId);
                    }
                }catch(err){Logger.log("개별 파일 업로드 실패 무시: "+err.toString());}
            });
        }

        const hasImage=imageUrls.length>0;
        const routeText=routeArray.map(function(route){return String(route||"").trim();}).filter(function(route){return route!=="";}).join(" ➡️ ");
        const routeStatus=typeof createRouteStatus==="function"?createRouteStatus(routeText):"대기";
        const maxCols=typeof ORDER_COL!=="undefined"?Math.max(...Object.values(ORDER_COL))+1:13;
        const row=new Array(maxCols).fill("");

        if(typeof ORDER_COL!=="undefined"){
            row[ORDER_COL.ORDER_ID]=orderId;
            row[ORDER_COL.REGISTER]="마스터";
            row[ORDER_COL.DATE]=new Date();
            row[ORDER_COL.PRODUCT]=productName;
            row[ORDER_COL.ROUTE]=routeText;
            row[ORDER_COL.ASSIGN_TYPE]=assignType;
            row[ORDER_COL.DRIVER_ID]=(assignType==="지정배차")?targetDriverId:"";
            row[ORDER_COL.STATUS]="미확인";
            row[ORDER_COL.IMAGE]=imageUrls.join("|");
            row[ORDER_COL.THUMB]=thumbUrls.join("|");
            row[ORDER_COL.ROUTE_STATUS]=routeStatus;
            row[ORDER_COL.REJECT_DRIVER]="";
            row[ORDER_COL.REJECT_TIME]="";
        }

        //==================================================
        // 1. Google Sheet 저장
        // 현재 운영 단계에서는 Sheet를 원본 DB로 유지
        //==================================================
        const orderSheet = getOrderSheet();

        if(!orderSheet){
            throw new Error(
                "오더 시트가 없습니다: " +
                ORDER_SHEET_NAME
            );
        }

        try{

            orderSheet.appendRow(row);

            SpreadsheetApp.flush();

            Logger.log(
                "✅ Google Sheet 신규 오더 저장 완료 = " +
                orderId
            );

        }catch(sheetErr){

            Logger.log(
                "❌ Google Sheet 신규 오더 저장 실패 = " +
                sheetErr.toString()
            );

            throw new Error(
                "Google Sheet 저장 실패로 Supabase 저장을 중단합니다."
            );
        }


        //==================================================
        // 2. Google Sheet 저장 성공 후 Supabase 저장
        //==================================================
        try{

            const orderData = {
                order_id: String(row[ORDER_COL.ORDER_ID] || "").trim(),

                register: String(row[ORDER_COL.REGISTER] || ""),

                created_at:
                    row[ORDER_COL.DATE] || null,

                product:
                    String(row[ORDER_COL.PRODUCT] || ""),

                route:
                    String(row[ORDER_COL.ROUTE] || ""),

                assign_type:
                    String(row[ORDER_COL.ASSIGN_TYPE] || "지정배차"),

                driver_id:
                    String(row[ORDER_COL.DRIVER_ID] || ""),

                status:
                    String(row[ORDER_COL.STATUS] || "미확인"),

                image_url:
                    String(row[ORDER_COL.IMAGE] || ""),

                thumb_url:
                    String(row[ORDER_COL.THUMB] || ""),

                route_status:
                    String(row[ORDER_COL.ROUTE_STATUS] || ""),

                reject_driver:
                    String(row[ORDER_COL.REJECT_DRIVER] || ""),

                reject_time:
                    row[ORDER_COL.REJECT_TIME] || null,

                completed_time:
                    row[ORDER_COL.COMPLETED_TIME] || null
            };

            const supabaseResult =
                syncOrderToSupabase(orderData);

            Logger.log(
                "📦 신규 오더 Supabase 저장 결과 = " +
                JSON.stringify(supabaseResult)
            );

        }catch(supabaseErr){

            // Sheet는 정상 저장되었으므로
            // Supabase 실패가 오더 등록 자체를 실패시키지는 않음
            Logger.log(
                "⚠️ Google Sheet 저장 완료 / Supabase 저장 실패 = " +
                supabaseErr.toString()
            );

        }

        let pushBody="("+productName+")📍 "+routeText;
        if(hasImage)pushBody+=" 🖼️ 이미지참조";

        try{
            if(assignType==="지정배차"){
           if(targetDriverId){
                    const fcmResult=sendFcmPushToDriver(targetDriverId,"📦 새로운 오더가 배정되었습니다!",pushBody,{orderId:orderId,type:"NEW_ORDER",collapse_key:orderId,timestamp:String(new Date().getTime())});
                    Logger.log("▶ 지정배차 기사 FCM 결과 = "+fcmResult);
                }else{
                    Logger.log("📋 지정배차 기사 미지정 → MasterApp 배차대기 알림");

                    try{
                        const masterPushResult=broadcastFcmPushToMasterApps(
                            "📋 배차 대기 오더",
                            "새로운 오더가 배차 대기 중입니다.\n"+pushBody,
                            {
                                orderId:orderId,
                                type:"ORDER_DISPATCH_WAITING",
                                assignType:"지정배차",
                                driverId:"",
                                status:"미확인",
                                collapse_key:orderId,
                                timestamp:String(new Date().getTime())
                            }
                        );

                        Logger.log("▶ MasterApp 배차대기 FCM 결과 = "+JSON.stringify(masterPushResult));
                    }catch(masterPushErr){
                        Logger.log("❌ MasterApp 배차대기 FCM 오류 = "+masterPushErr.toString());
                    }
                }
            /* }else{
                const driverSheet=getDriverSheet();
                const driverData=driverSheet?driverSheet.getDataRange().getValues():[];
                const workingDrivers=[];

                for(let i=1;i<driverData.length;i++){
                    const driverRow=driverData[i];
                    const driverId=String(driverRow[DRIVER_COL.ID]||"").trim();
                    const workStatus=String(driverRow[DRIVER_COL.STATUS]||"").trim();

                    if(driverId&&workStatus==="근무중"){
                        workingDrivers.push(driverId);
                    }
                }

                Logger.log("▶ 선착순 자동배차 근무중 기사: "+workingDrivers.length+"명");

                const pushResults=[];

                workingDrivers.forEach(function(driverId){
                    try{
                        const result=sendFcmPushToDriver(
                            driverId,
                            "🔔 새로운 오더가 등록되었습니다!",
                            pushBody,
                            {
                                orderId:orderId,
                                type:"NEW_ORDER",
                                collapse_key:orderId,
                                timestamp:String(new Date().getTime())
                            }
                        );

                        pushResults.push({
                            driverId:driverId,
                            result:result
                        });
                    }catch(driverPushErr){
                        Logger.log("❌ 기사 FCM 실패 ["+driverId+"]: "+driverPushErr.toString());
                    }
                });

                Logger.log("▶ 선착순 자동배차 FCM 결과 = "+JSON.stringify(pushResults));*/
                }else{
                    Logger.log("⏸️ 선착순배차 현재 비활성화 - 전체 기사 FCM 발송 안 함");
                }            
        }catch(pushErr){Logger.log("❌ FCM PUSH 예외 = "+pushErr.toString());}

        return{success:true,orderId:orderId,message:"오더 등록 완료\n\n주문번호: "+orderId};
    }catch(e){
        Logger.log("addCompositeOrder 치명적 오류: "+e.toString());
        return{success:false,message:"오더 등록 중 오류 발생: "+e.message};
    }
}

//==================================================
// 오더 목록 조회
//==================================================
function getOrdersData(){
    const data=getOrderData();
    const result=[];
    if(!data||data.length<=1)return JSON.stringify([]);

    for(let i=1;i<data.length;i++){
        if(!data[i])continue;
        const row=data[i].slice();
        let correctedMap={};
        try{
            const correctedJSON=PropertiesService.getScriptProperties().getProperty("ORDER_CORRECTED_MAP");
            if(correctedJSON)correctedMap=JSON.parse(correctedJSON)||{};
        }catch(e){}

        if(row[ORDER_COL.DATE] instanceof Date)row[ORDER_COL.DATE]=Utilities.formatDate(row[ORDER_COL.DATE],"Asia/Seoul","yyyy-MM-dd HH:mm");
        else row[ORDER_COL.DATE]=row[ORDER_COL.DATE]?String(row[ORDER_COL.DATE]):"시간정보없음";

        row[ORDER_COL.STATUS]=row[ORDER_COL.STATUS]!==undefined&&row[ORDER_COL.STATUS]!==null?String(row[ORDER_COL.STATUS]).trim():"미확인";
        row.push(correctedMap[String(row[ORDER_COL.ORDER_ID]||"")]===true);
        result.push(row);
    }

    return JSON.stringify(result);
}

//==================================================
// 선착순 배차 수락
// Google Sheet + Supabase PATCH
//==================================================
function acceptFleetingOrder(orderId,driverId){
    if(!ENABLE_FLEETING_DISPATCH)return{success:false,message:"현재 선착순배차는 비활성화되어 있습니다."};
    const lock=LockService.getScriptLock();
    try{
        Logger.log("========== [ACCEPT START] ==========");
        Logger.log("orderId="+orderId+" / driverId="+driverId);
        lock.waitLock(5000);
        orderId=String(orderId||"").trim();
        driverId=String(driverId||"").trim();
        const order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data))return{success:false,message:"오더 없음"};
        if(!driverId)return{success:false,message:"기사 ID가 없습니다."};
        const status=String(order.data[ORDER_COL.STATUS]||"").trim();
        if(status==="수락")return{success:false,message:"앗!! 다른 기사님이 이미 수락하셨습니다"};
        if(status==="배송완료"||status==="배송중")return{success:false,message:"이미 처리된 오더입니다."};
        const sheet=getOrderSheet();
        if(!sheet)throw new Error("오더 시트를 찾을 수 없습니다.");
        updateCell(sheet,order.row,ORDER_COL.DRIVER_ID+1,driverId);
        updateCell(sheet,order.row,ORDER_COL.STATUS+1,"수락");
        SpreadsheetApp.flush();
        clearProjectCache();
        Logger.log("✅ Google Sheet 수락 저장 완료 = "+orderId);
        try{
            const supabaseResult=updateOrderToSupabase(orderId,{driver_id:driverId,status:"수락"});
            Logger.log("📦 선착순배차 수락 Supabase PATCH 결과="+JSON.stringify(supabaseResult));
        }catch(supabaseErr){
            Logger.log("⚠️ Google Sheet 수락 완료 / Supabase 수락 동기화 실패="+supabaseErr.toString());
        }
        try{
            const fcmResult=notifyAdminsOrderEvent("ACCEPTED",orderId,driverId,order.data);
            Logger.log("📡 관리자 수락 FCM 결과="+fcmResult);
        }catch(adminErr){
            Logger.log("❌ 관리자 수락 FCM 예외="+adminErr.toString());
        }
        try{
            const masterFcmResult=notifyMasterAppOrderEvent("ACCEPTED",orderId,driverId,order.data);
            Logger.log("📡 MasterApp 수락 FCM 결과="+masterFcmResult);
        }catch(masterErr){
            Logger.log("❌ MasterApp 수락 FCM 예외="+masterErr.toString());
        }
        Logger.log("========== [ACCEPT SUCCESS] ==========");
        return{success:true,message:"배차 수락 완료"};
    }catch(e){
        Logger.log("❌ acceptFleetingOrder 오류="+e.toString());
        Logger.log(e.stack||"");
        return{success:false,message:"서버 오류: "+e.message};
    }finally{
        try{lock.releaseLock();}catch(e){Logger.log("Lock 해제 오류="+e.toString());}
    }
}

//==================================================
// 지정배차,재배차 수락
//==================================================
function acceptOrder(orderId,driverId){
    try{
        orderId=String(orderId||"").trim();
        driverId=String(driverId||"").trim();
        if(!orderId)return{success:false,msg:"오더 ID가 없습니다."};
        if(!driverId)return{success:false,msg:"기사 ID가 없습니다."};
        const order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data))return{success:false,msg:"오더를 찾을 수 없습니다."};
        const assignType=String(order.data[ORDER_COL.ASSIGN_TYPE]||"").trim();
        if(assignType==="선착순배차")return acceptFleetingOrder(orderId,driverId);
        if(assignType==="지정배차"||assignType==="재배차"||assignType===""){
            const sheet=getOrderSheet();
            if(!sheet)return{success:false,msg:"오더 시트를 찾을 수 없습니다."};
            const status=String(order.data[ORDER_COL.STATUS]||"").trim();
            if(status==="배송완료"||status==="배송중")return{success:false,msg:"이미 처리된 오더입니다."};
            if(status==="수락")return{success:false,msg:"이미 수락된 오더입니다."};
            updateCell(sheet,order.row,ORDER_COL.DRIVER_ID+1,driverId);
            updateCell(sheet,order.row,ORDER_COL.STATUS+1,"수락");
            SpreadsheetApp.flush();
            clearProjectCache();
            try{
                const sbResult=updateOrderToSupabase(orderId,{driver_id:driverId,status:"수락"});
                Logger.log("✅ 지정배차/재배차 수락 Supabase PATCH = "+JSON.stringify(sbResult));
            }catch(sbErr){
                Logger.log("⚠️ Google Sheet 수락 완료 / Supabase 수락 동기화 실패 = "+sbErr.toString());
            }
            try{notifyAdminsOrderEvent("ACCEPTED",orderId,driverId,order.data);}catch(e){Logger.log("관리자 수락 FCM 예외 = "+e.toString());}
            try{notifyMasterAppOrderEvent("ACCEPTED",orderId,driverId,order.data);}catch(e){Logger.log("MasterApp 수락 FCM 예외 = "+e.toString());}
            return{success:true,msg:"배차 수락 완료"};
        }
        return{success:false,msg:"지원하지 않는 배차유형입니다: "+assignType};
    }catch(e){
        Logger.log("❌ acceptOrder 오류 = "+e.toString());
        Logger.log(e.stack||"");
        return{success:false,msg:"수락 처리 중 오류가 발생했습니다: "+e.message};
    }
}

//==================================================
// 선착순 거절
// Google Sheet + Supabase PATCH
//==================================================
function rejectFleetingOrder(orderId,driverId){
    try{
        orderId=String(orderId||"").trim();
        driverId=String(driverId||"").trim();
        const order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data))return{success:false,message:"오더 없음"};
        const sheet=getOrderSheet();
        if(!sheet)throw new Error("오더 시트를 찾을 수 없습니다.");
        const rejectTime=new Date();
        updateCell(sheet,order.row,ORDER_COL.DRIVER_ID+1,"");
        updateCell(sheet,order.row,ORDER_COL.STATUS+1,"거절됨");
        updateCell(sheet,order.row,ORDER_COL.REJECT_DRIVER+1,driverId);
        updateCell(sheet,order.row,ORDER_COL.REJECT_TIME+1,rejectTime);
        SpreadsheetApp.flush();
        clearProjectCache();
        Logger.log("✅ Google Sheet 선착순 거절 저장 완료 = "+orderId);
        try{
            const supabaseResult=updateOrderToSupabase(orderId,{driver_id:"",status:"거절됨",reject_driver:driverId,reject_time:rejectTime});
            Logger.log("📦 선착순배차 거절 Supabase PATCH 결과="+JSON.stringify(supabaseResult));
        }catch(supabaseErr){
            Logger.log("⚠️ Google Sheet 거절 완료 / Supabase 거절 동기화 실패="+supabaseErr.toString());
        }
        try{
            notifyAdminsOrderEvent("REJECTED",orderId,driverId,order.data);
        }catch(adminErr){
            Logger.log("관리자 거절 FCM 예외: "+adminErr.toString());
        }
        try{
            notifyMasterAppOrderEvent("REJECTED",orderId,driverId,order.data);
        }catch(masterErr){
            Logger.log("MasterApp 거절 FCM 예외: "+masterErr.toString());
        }
        return{success:true};
    }catch(e){
        Logger.log("rejectFleetingOrder 오류: "+e.toString());
        Logger.log(e.stack||"");
        return{success:false,message:"거절 처리 중 오류가 발생했습니다."};
    }
}

//==================================================
// 재배차
// Google Sheet + Supabase PATCH
//==================================================
function redispatchOrder(orderId,driverId){
    try{
        const order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data))return{success:false,message:"오더 없음"};
        orderId=String(orderId||"").trim();
        driverId=String(driverId||"").trim();
        if(!orderId)return{success:false,message:"오더 ID가 없습니다."};
        if(!driverId)return{success:false,message:"기사 ID가 없습니다."};

        const routeText=String(order.data[ORDER_COL.ROUTE]||"");
        const sheet=getOrderSheet();
        if(!sheet)return{success:false,message:"오더 시트를 찾을 수 없습니다."};

        updateCell(sheet,order.row,ORDER_COL.DRIVER_ID+1,driverId);
        updateCell(sheet,order.row,ORDER_COL.STATUS+1,"미확인");
        SpreadsheetApp.flush();
        clearProjectCache();

        Logger.log("✅ Google Sheet 재배차 저장 완료 = "+orderId+" / driver="+driverId);

        try{
            const supabaseResult=updateOrderToSupabase(orderId,{driver_id:driverId,status:"미확인"});
            Logger.log("🔄 재배차 Supabase PATCH = "+JSON.stringify(supabaseResult));
        }catch(supabaseErr){
            Logger.log("❌ 재배차 Supabase PATCH 실패 = "+supabaseErr.toString());
        }

        const productName=String(order.data[ORDER_COL.PRODUCT]||"복합 배송").trim();
        const imageData=String(order.data[ORDER_COL.IMAGE]||"").trim();
        const thumbData=String(order.data[ORDER_COL.THUMB]||"").trim();
        const hasImage=(imageData!==""&&imageData!=="|"&&imageData!=="null")||(thumbData!==""&&thumbData!=="|"&&thumbData!=="null");

        const props=PropertiesService.getScriptProperties();
        let correctedMap={};
        try{
            const correctedJSON=props.getProperty("ORDER_CORRECTED_MAP");
            if(correctedJSON)correctedMap=JSON.parse(correctedJSON)||{};
        }catch(e){}

        const isCorrected=correctedMap[String(orderId)]===true;
        let pushBody=(isCorrected?"🛠️(정정) ":"")+"("+productName+")📍 "+(routeText||"경로 정보 없음");
        if(hasImage)pushBody+=" 🖼️ 이미지참조";

        try{
            sendFcmPushToDriver(driverId,"📦 새로운 오더가 배정되었습니다!",pushBody,{orderId:orderId,type:"NEW_ORDER",collapse_key:orderId,timestamp:String(new Date().getTime())});
        }catch(pushErr){
            Logger.log("재배차 푸시 예외: "+pushErr.toString());
        }

        return{success:true};
    }catch(e){
        Logger.log("redispatchOrder 치명적 오류: "+e.toString());
        return{success:false,message:"재배차 처리 중 오류 발생: "+e.message};
    }
}

//==================================================
// 경유지 상태 변경
// Google Sheet + Supabase PATCH
//==================================================
function updateIndividualLocationStatus(orderId,routeIdx,nextStatus){
    try{
        orderId=String(orderId||"").trim();
        routeIdx=Number(routeIdx);
        nextStatus=String(nextStatus||"").trim();

        if(!orderId)return{success:false};
        if(!Number.isInteger(routeIdx)||routeIdx<0)return{success:false};
        if(!nextStatus)return{success:false};

        const order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data))return{success:false};

        const status=String(order.data[ORDER_COL.ROUTE_STATUS]||"").split(",").map(function(v){return String(v||"").trim()||"미픽업";});

        if(routeIdx>=status.length)return{success:false};

        status[routeIdx]=nextStatus;

        const newRouteStatus=status.join(",");

        const sheet=getOrderSheet();
        if(!sheet)return{success:false};

        updateCell(sheet,order.row,ORDER_COL.ROUTE_STATUS+1,newRouteStatus);
        SpreadsheetApp.flush();
        clearProjectCache();

        Logger.log("✅ Google Sheet 경유지 상태 저장 완료 = "+orderId);
        Logger.log("📍 routeIdx = "+routeIdx+" / nextStatus = "+nextStatus);
        Logger.log("📍 route_status = "+newRouteStatus);

        try{
            const supabaseResult=updateOrderToSupabase(orderId,{route_status:newRouteStatus});
            Logger.log("🔄 경유지 상태 Supabase PATCH = "+JSON.stringify(supabaseResult));
        }catch(supabaseErr){
            Logger.log("❌ 경유지 상태 Supabase PATCH 실패 = "+supabaseErr.toString());
        }

        return{success:true};
    }catch(e){
        Logger.log("❌ updateIndividualLocationStatus 오류 = "+e.toString());
        Logger.log(e.stack||"");
        return{success:false};
    }
}

//==================================================
// 배송 완료
// Google Sheet + Supabase 직접 PATCH
//==================================================
function completeOrder(orderId){
    try{
        orderId=String(orderId||"").trim();
        Logger.log("========================================");
        Logger.log("📦 completeOrder 호출");
        Logger.log("orderId = "+orderId);

        const order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data)){
            Logger.log("❌ 오더를 찾을 수 없음");
            return false;
        }

        const driverId=String(order.data[ORDER_COL.DRIVER_ID]||"").trim();
        Logger.log("🚚 driverId = "+driverId);

        const completionTime=new Date();
        const count=String(order.data[ORDER_COL.ROUTE]||"").split("➡️").length;
        const result=[];

        for(let i=0;i<count;i++){result.push("배송완료");}

        const finalRouteStatus=result.join(",");

        const sheet=getOrderSheet();
        if(!sheet){
            Logger.log("❌ 오더 시트를 찾을 수 없음");
            return false;
        }

        updateCell(sheet,order.row,ORDER_COL.STATUS+1,"배송완료");
        updateCell(sheet,order.row,ORDER_COL.COMPLETED_TIME+1,completionTime);
        updateCell(sheet,order.row,ORDER_COL.ROUTE_STATUS+1,finalRouteStatus);

        SpreadsheetApp.flush();
        clearProjectCache();

        Logger.log("✅ Google Sheet 배송완료 저장 완료 = "+orderId);
        Logger.log("📍 route_status = "+finalRouteStatus);
        Logger.log("🕒 completed_time = "+completionTime);

        //==================================================
        // ★ Supabase 직접 PATCH
        //==================================================
        try{
            const supabaseResult=updateOrderToSupabase(orderId,{
                status:"배송완료",
                completed_time:completionTime,
                route_status:finalRouteStatus
            });

            Logger.log("🔄 배송완료 Supabase PATCH = "+JSON.stringify(supabaseResult));
        }catch(supabaseErr){
            Logger.log("❌ 배송완료 Supabase PATCH 실패 = "+supabaseErr.toString());
        }

        Logger.log("✅ 오더 배송완료 DB 처리 완료");

        try{
            Logger.log("📡 관리자 배송완료 FCM 호출 시작");
            const pushResult=notifyAdminsOrderEvent("COMPLETED",orderId,driverId,order.data);
            Logger.log("📡 관리자 배송완료 FCM 결과 = "+pushResult);
        }catch(adminErr){
            Logger.log("❌ 관리자 완료 FCM 예외 = "+adminErr.toString());
        }

        try{
            Logger.log("📡 MasterApp 배송완료 FCM 호출 시작");
            const masterPushResult=notifyMasterAppOrderEvent("COMPLETED",orderId,driverId,order.data);
            Logger.log("📡 MasterApp 배송완료 FCM 결과 = "+masterPushResult);
        }catch(masterErr){
            Logger.log("❌ MasterApp 완료 FCM 예외 = "+masterErr.toString());
        }

        Logger.log("========================================");
        return true;

    }catch(e){
        Logger.log("❌ completeOrder 오류 = "+e.toString());
        Logger.log(e.stack||"");
        return false;
    }
}

//==================================================
// 오더 취소
//==================================================
function cancelOrder(orderId){
    try{
        orderId=String(orderId||"").trim();

        const order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data))return{success:false,message:"오더 없음"};

        const image=String(order.data[ORDER_COL.IMAGE]||"");

        if(image){
            image.split("|").forEach(function(url){
                const id=getFileId(url);
                if(id){
                    try{DriveApp.getFileById(id).setTrashed(true);}catch(e){}
                }
            });
        }

        getOrderSheet().deleteRow(order.row);
        SpreadsheetApp.flush();
        clearProjectCache();

        //==================================================
        // ★ Google Sheet 삭제 후 Supabase도 삭제
        //==================================================
        try{
            const sbResult=deleteOrderFromSupabase(orderId);

            if(!sbResult.success){
                Logger.log("⚠️ Supabase 오더 삭제 실패 = "+orderId);
            }else{
                Logger.log("✅ Google Sheet + Supabase 오더 삭제 완료 = "+orderId);
            }
        }catch(supabaseErr){
            Logger.log("❌ Supabase 삭제 동기화 오류 = "+supabaseErr.toString());
        }

        return{success:true,message:"삭제 완료"};

    }catch(e){
        Logger.log("❌ cancelOrder 오류 = "+e.toString());
        return{success:false,message:"오더 취소 중 오류가 발생했습니다: "+e.message};
    }
}

//==================================================
// 오늘 통계
//==================================================
function getTodayStats(driverId){
    const data=getOrderData();
    let waiting=0;
    let active=0;

    if(!data||data.length<=1)return JSON.stringify({waiting:0,active:0});

    for(let i=1;i<data.length;i++){
        if(!data[i])continue;

        const assignedDriver=String(data[i][ORDER_COL.DRIVER_ID]||"").trim();
        if(assignedDriver!==String(driverId).trim())continue;

        const status=String(data[i][ORDER_COL.STATUS]||"").replace(/\s+/g,"").trim();

        if(status.includes("완료")||status.includes("배송완료"))continue;
        if(status.includes("미확인")||status==="")waiting++;
        else if(status.includes("진행중")||status.includes("수락")||status.includes("배송중"))active++;
        else waiting++;
    }

    return JSON.stringify({waiting:waiting,active:active});
}

//==================================================
// 프론트엔드 연동용 래퍼
//==================================================
function registerCompositeOrder(orderData){
    var productName=orderData.productName;
    var routes=orderData.routes;
    var photos=orderData.photos;
    var assignType=orderData.assignType;
    var targetDriverId="";

    if(assignType&&assignType.indexOf("|")!==-1){
        var parts=assignType.split("|");
        targetDriverId=parts[0];
        assignType="지정배차";
    }

    return addCompositeOrder(productName,routes,photos,assignType,targetDriverId);
}

//==================================================
// 관제판 데이터 조회
//==================================================
function getOrderDashboardData(keyword){
    try{
        var rawDataJSON=getOrdersData();
        var rawArray=typeof rawDataJSON==="string"?JSON.parse(rawDataJSON):rawDataJSON;
        if(!rawArray||!Array.isArray(rawArray)||rawArray.length===0)return JSON.stringify([]);

        var correctedMap={};
        try{
            var correctedJSON=PropertiesService.getScriptProperties().getProperty("ORDER_CORRECTED_MAP");
            if(correctedJSON)correctedMap=JSON.parse(correctedJSON)||{};
        }catch(correctedErr){
            Logger.log("정정정보 로드 실패: "+correctedErr.message);
        }

        var driverMap={};
        try{
            var driverData=getDriverData();
            if(driverData&&driverData.length>1){
                for(var d=1;d<driverData.length;d++){
                    var dRow=driverData[d];
                    var dId=String(dRow[DRIVER_COL.ID]||"").trim();
                    var dName=String(dRow[DRIVER_COL.NAME]||"").trim();
                    if(dId)driverMap[dId]=dName;
                }
            }
        }catch(e){
            Logger.log("기사 데이터 로드 실패: "+e.message);
        }

        var formattedOrders=[];

        rawArray.forEach(function(row){
            var orderId=row[ORDER_COL.ORDER_ID]||"ORDER-000";
            var productName=row[ORDER_COL.PRODUCT]||"상품명 미기재";
            var orderStatus=String(row[ORDER_COL.STATUS]||"미확인").trim();
            var rawDriverId=String(row[ORDER_COL.DRIVER_ID]||"").trim();
            var assignType=String(row[ORDER_COL.ASSIGN_TYPE]||"").trim();

            var driverName=rawDriverId;
            if(driverMap[rawDriverId])driverName=driverMap[rawDriverId];
            else if(!rawDriverId)driverName="미배정";

            var regTime=row[ORDER_COL.DATE]||"-";
            var rawRouteStr=row[ORDER_COL.ROUTE]||"";
            var routeStr=String(rawRouteStr).replace(/경로/g,"").trim();

            var routeStatStr=row[ORDER_COL.ROUTE_STATUS]||"";
            var imageStr=row[ORDER_COL.THUMB]||row[ORDER_COL.IMAGE]||"";

            var routeList=[];

            if(routeStr){
                var rTexts=routeStr.split("➡️");
                var rStats=String(routeStatStr).split(",");

                rTexts.forEach(function(t,idx){
                    var sVal=(rStats[idx]||"미픽업").trim();
                    routeList.push({
                        text:t.trim(),
                        status:sVal
                    });
                });
            }

            var photoList=[];
            if(imageStr)photoList=String(imageStr).split("|").filter(Boolean);

            if(keyword&&keyword.trim()!==""){
                var kw=keyword.trim().toLowerCase();
                var combinedText=(orderId+productName+driverName+routeStr).toLowerCase();
                if(combinedText.indexOf(kw)===-1)return;
            }

            formattedOrders.push({
                id:orderId,
                productName:productName,
                orderStatus:orderStatus,
                driverId:rawDriverId,
                assignType:assignType,
                driverName:driverName,
                regTime:regTime,
                routes:routeList,
                photos:photoList,
                isCorrected:correctedMap[String(orderId)]===true
            });
        });

        return JSON.stringify(formattedOrders);

    }catch(err){
        Logger.log("getOrderDashboardData 실행 중 오류: "+err.message);
        return JSON.stringify([]);
    }
}

//==================================================
// 기존 오더 수정 / 경로 추가 / 사진 추가
// 기존 경로 배송상태 절대 유지
// 신규 경로만 미픽업
// Google Sheet + Supabase 직접 PATCH
//==================================================
function updateOrderDetails(orderId,productName,routeArray,uploadFiles){
    try{
        orderId=String(orderId||"").trim();
        productName=String(productName||"").trim();
        routeArray=Array.isArray(routeArray)?routeArray:[];
        uploadFiles=Array.isArray(uploadFiles)?uploadFiles:[];

        if(!orderId)return{success:false,message:"오더ID가 없습니다."};
        if(!productName)productName="상품명 미기재";

        var order=findOrderRow(orderId);
        if(!order||!Array.isArray(order.data))return{success:false,message:"수정할 오더를 찾을 수 없습니다."};

        var sheet=getOrderSheet();
        if(!sheet)return{success:false,message:"오더 시트를 찾을 수 없습니다."};

        var rowIndex=order.row;
        var oldRouteStr=String(order.data[ORDER_COL.ROUTE]||"").trim();

        var oldRoutes=oldRouteStr?oldRouteStr.split("➡️").map(function(v){return String(v||"").trim();}).filter(function(v){return v!=="";}):[];

        var oldRouteStatusStr=String(order.data[ORDER_COL.ROUTE_STATUS]||"").trim();

        var oldStatuses=oldRouteStatusStr?oldRouteStatusStr.split(",").map(function(v){return String(v||"").trim()||"미픽업";}):[];

        var cleanRoutes=[];
        var newStatuses=[];
        var usedOriginalIndexes={};

        routeArray.forEach(function(route){
            var text="";
            var originalIndex=-1;

            if(typeof route==="object"&&route!==null){
                text=String(route.text||"").trim();
                originalIndex=Number(route.originalIndex);
            }else{
                text=String(route||"").trim();
                originalIndex=-1;
            }

            if(!text)return;
            if(!Number.isInteger(originalIndex))originalIndex=-1;

            cleanRoutes.push(text);

            if(originalIndex>=0&&originalIndex<oldRoutes.length&&originalIndex<oldStatuses.length&&!usedOriginalIndexes[originalIndex]){
                newStatuses.push(oldStatuses[originalIndex]||"미픽업");
                usedOriginalIndexes[originalIndex]=true;
            }else{
                newStatuses.push("미픽업");
            }
        });

        if(cleanRoutes.length===0)return{success:false,message:"배송지가 없습니다."};

        var finalRoute=cleanRoutes.join(" ➡️ ");
        var finalRouteStatus=newStatuses.join(",");

        updateCell(sheet,rowIndex,ORDER_COL.PRODUCT+1,productName);
        updateCell(sheet,rowIndex,ORDER_COL.ROUTE+1,finalRoute);
        updateCell(sheet,rowIndex,ORDER_COL.ROUTE_STATUS+1,finalRouteStatus);

        var addedImageUrls=[];
        var addedThumbUrls=[];
        var finalImageUrl=String(order.data[ORDER_COL.IMAGE]||"").trim();
        var finalThumbUrl=String(order.data[ORDER_COL.THUMB]||"").trim();

        if(uploadFiles.length>0&&typeof UPLOAD_FOLDER_ID!=="undefined"){
            try{
                var folder=DriveApp.getFolderById(UPLOAD_FOLDER_ID);

                uploadFiles.forEach(function(file,index){
                    try{
                        if(file&&file.base64){
                            var decodedBytes=Utilities.base64Decode(file.base64);
                            var blob=Utilities.newBlob(decodedBytes,file.mime||"image/jpeg",file.name||("edit_"+index+".jpg"));
                            var fileName=typeof generateUploadFileName==="function"?generateUploadFileName(orderId,"EDIT_"+index,file.name):(orderId+"_EDIT_"+index+"_"+(file.name||"file.jpg"));
                            blob.setName(fileName);

                            var driveFile=folder.createFile(blob);
                            var fileId=driveFile.getId();

                            addedImageUrls.push(typeof makeDriveImageUrl==="function"?makeDriveImageUrl(fileId):fileId);
                            addedThumbUrls.push(typeof makePreviewUrl==="function"?makePreviewUrl(fileId):fileId);
                        }
                    }catch(fileErr){
                        Logger.log("수정 사진 개별 업로드 실패: "+fileErr.toString());
                    }
                });
            }catch(uploadErr){
                Logger.log("수정 사진 업로드 오류: "+uploadErr.toString());
            }
        }

        if(addedImageUrls.length>0){
            var oldImageStr=String(order.data[ORDER_COL.IMAGE]||"").trim();
            var oldThumbStr=String(order.data[ORDER_COL.THUMB]||"").trim();

            var oldImages=oldImageStr?oldImageStr.split("|").map(function(v){return String(v||"").trim();}).filter(Boolean):[];
            var oldThumbs=oldThumbStr?oldThumbStr.split("|").map(function(v){return String(v||"").trim();}).filter(Boolean):[];

            finalImageUrl=oldImages.concat(addedImageUrls).join("|");
            finalThumbUrl=oldThumbs.concat(addedThumbUrls).join("|");

            updateCell(sheet,rowIndex,ORDER_COL.IMAGE+1,finalImageUrl);
            updateCell(sheet,rowIndex,ORDER_COL.THUMB+1,finalThumbUrl);
        }

        SpreadsheetApp.flush();
        clearProjectCache();

        //==================================================
        // 정정 표시
        //==================================================
        try{
            var props=PropertiesService.getScriptProperties();
            var correctedJSON=props.getProperty("ORDER_CORRECTED_MAP");
            var correctedMap=correctedJSON?JSON.parse(correctedJSON):{};
            correctedMap[orderId]=true;
            props.setProperty("ORDER_CORRECTED_MAP",JSON.stringify(correctedMap));
        }catch(propErr){
            Logger.log("정정정보 저장 실패: "+propErr.message);
        }

        //==================================================
        // ★ Google Sheet 수정 완료 후 Supabase 직접 PATCH
        //==================================================
        try{
            var updateData={
                product:productName,
                route:finalRoute,
                route_status:finalRouteStatus
            };

            if(addedImageUrls.length>0){
                updateData.image_url=finalImageUrl;
                updateData.thumb_url=finalThumbUrl;
            }

            var supabaseResult=updateOrderToSupabase(orderId,updateData);

            Logger.log("🔄 오더 수정 Supabase PATCH = "+orderId);
            Logger.log("Supabase 수정 데이터 = "+JSON.stringify(updateData));
            Logger.log("Supabase 결과 = "+JSON.stringify(supabaseResult));
        }catch(supabaseErr){
            Logger.log("❌ 오더 수정 Supabase PATCH 실패 = "+orderId+" / "+supabaseErr.toString());
        }

        Logger.log("========================================");
        Logger.log("🛠️ 기존 오더 정정 완료");
        Logger.log("orderId = "+orderId);
        Logger.log("상품명 = "+productName);
        Logger.log("기존 경로 = "+oldRouteStr);
        Logger.log("수정 경로 = "+finalRoute);
        Logger.log("기존 K열 = "+oldRouteStatusStr);
        Logger.log("수정 K열 = "+finalRouteStatus);
        Logger.log("추가 사진 = "+addedImageUrls.length+"장");
        Logger.log("========================================");

        return{
            success:true,
            orderId:orderId,
            productName:productName,
            routes:cleanRoutes,
            routeStatuses:newStatuses,
            addedPhotos:addedImageUrls.length,
            message:"오더 수정 완료"
        };

    }catch(e){
        Logger.log("updateOrderDetails 오류: "+e.toString());
        Logger.log(e.stack||"");
        return{
            success:false,
            message:"오더 수정 중 오류가 발생했습니다: "+e.message
        };
    }
}


//==================================================
// 엑셀 오더 조회
//==================================================
function fetchOrdersForExcel(startDateStr,endDateStr){
    try{
        const sheet=getOrderSheet();
        if(!sheet)return"ERROR: '오더_DB' 시트를 찾을 수 없습니다.";

        const data=sheet.getDataRange().getValues();
        if(!data||data.length<=1)return[];

        let orders=[];

        for(let i=1;i<data.length;i++){
            let rowData=data[i];
            if(!rowData||rowData.length===0)continue;

            let orderId=String(rowData[ORDER_COL.ORDER_ID]||"").trim();
            let rawDateVal=rowData[ORDER_COL.DATE]!==undefined?rowData[ORDER_COL.DATE]:rowData[ORDER_COL.REGISTER];

            if(!orderId||!rawDateVal)continue;

            let dateStr=String(rawDateVal).trim();
            let rowDateStr="";
            let parts=dateStr.split(/[\.\s-]/);
            let cleanParts=parts.filter(function(p){return p.length>0;});

            if(cleanParts.length>=3&&cleanParts[0].length===4){
                rowDateStr=`${cleanParts[0]}-${String(cleanParts[1]).padStart(2,"0")}-${String(cleanParts[2]).padStart(2,"0")}`;
            }else{
                let parsed=new Date(dateStr);
                if(!isNaN(parsed.getTime()))rowDateStr=`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,"0")}-${String(parsed.getDate()).padStart(2,"0")}`;
                else continue;
            }

            if(startDateStr&&rowDateStr<startDateStr)continue;
            if(endDateStr&&rowDateStr>endDateStr)continue;

            let rawRoute=rowData[ORDER_COL.ROUTE];
            let routeStr="";

            try{
                if(rawRoute){
                    let parsedRoute=typeof rawRoute==="string"&&rawRoute.startsWith("[")?JSON.parse(rawRoute):rawRoute;
                    routeStr=Array.isArray(parsedRoute)?parsedRoute.join(" ➡️ "):String(parsedRoute);
                }
            }catch(e){routeStr=String(rawRoute||"");}

            let rawDriverId=String(rowData[ORDER_COL.DRIVER_ID]||"").trim();
            let driverDisplayName=rawDriverId;

            if(rawDriverId){
                let driverInfo=findDriverRow(rawDriverId);
                if(driverInfo&&driverInfo.data&&driverInfo.data[DRIVER_COL.NAME])driverDisplayName=String(driverInfo.data[DRIVER_COL.NAME]).trim();
            }

            orders.push({id:orderId,productName:String(rowData[ORDER_COL.PRODUCT]||""),route:routeStr,driverName:driverDisplayName,regTime:String(rawDateVal)});
        }

        Logger.log(`✅ [Excel 다운로드 성공] 총 ${orders.length}개 오더 반영 (기사 이름 매핑 완료)`);
        return orders;
    }catch(err){
        return"ERROR_MSG: "+err.toString();
    }
}

//==================================================
// 선착순 FCM 전체 기사 전송
//==================================================
function broadcastFcmPushToAllDrivers(title,body,extraData){
    try{
        const driverData=getDriverData();
        if(!driverData||driverData.length<=1)return false;

        const sentTokens={};
        let totalDrivers=0;
        let tokenDrivers=0;
        let successCount=0;
        let failCount=0;

        for(let i=1;i<driverData.length;i++){
            try{
                const row=driverData[i];
                if(!row)continue;

                totalDrivers++;

                const driverId=String(row[DRIVER_COL.ID]||"").trim();
                if(!driverId)continue;

                const fcmToken=String(row[9]||"").trim();
                if(!fcmToken)continue;

                tokenDrivers++;

                if(sentTokens[fcmToken])continue;
                sentTokens[fcmToken]=true;

                const result=sendFcmPushToDriver(driverId,title,body,extraData);

                if(result)successCount++;
                else failCount++;
            }catch(driverErr){
                failCount++;
                Logger.log("❌ 개별 기사 FCM 예외: "+driverErr.toString());
            }
        }

        Logger.log("전체 기사 = "+totalDrivers+" / Token = "+tokenDrivers+" / 성공 = "+successCount+" / 실패 = "+failCount);
        return successCount>0;
    }catch(e){
        Logger.log("❌ broadcastFcmPushToAllDrivers 오류: "+e.toString());
        return false;
    }
}

//==================================================
// 기사에게 FCM 푸시 알림 전송
// Firebase FCM HTTP v1
//==================================================
function sendFcmPushToDriver(driverId,title,body,extraData){
    try{
        driverId=String(driverId||"").trim();
        if(!driverId)return false;

        const driver=findDriverRow(driverId);
        if(!driver||!driver.data)return false;

        const fcmToken=String(driver.data[9]||"").trim();
        if(!fcmToken)return false;

        const accessToken=getFirebaseAccessToken();
        if(!accessToken)return false;

        const projectId="bu-reum-driver";
        const url="https://fcm.googleapis.com/v1/projects/"+projectId+"/messages:send";

        const data={title:String(title||"📦 새 오더 도착!"),message:String(body||"새로운 배송 오더가 등록되었습니다."),timestamp:String(Date.now())};

        if(extraData){
            for(const key in extraData){
                if(Object.prototype.hasOwnProperty.call(extraData,key))data[key]=String(extraData[key]);
            }
        }

        if(!data.orderId)data.orderId="UNKNOWN-"+Date.now();
        if(!data.type)data.type="NEW_ORDER";
        if(!data.collapse_key)data.collapse_key=String(data.orderId);

        const payload={message:{token:fcmToken,data:data,android:{priority:"HIGH"}}};

        const options={method:"post",contentType:"application/json",headers:{Authorization:"Bearer "+accessToken},payload:JSON.stringify(payload),muteHttpExceptions:true};
        const response=UrlFetchApp.fetch(url,options);

        Logger.log("📡 기사 FCM HTTP = "+response.getResponseCode());
        Logger.log("📡 기사 FCM 응답 = "+response.getContentText());

        return response.getResponseCode()===200;
    }catch(err){
        Logger.log("❌ sendFcmPushToDriver 오류: "+err.toString());
        return false;
    }
}

//==================================================
// 👑 관리자앱 전용 Firebase FCM HTTP v1 Access Token
// Firebase Project : adminapp-c5661
//
// ⚠️ 기사앱용 getFirebaseAccessToken()과 분리
// ⚠️ Script Properties:
//    FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON
//==================================================
function getAdminFirebaseAccessToken(){

    const properties = PropertiesService.getScriptProperties();

    const json = properties.getProperty(
        "FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON"
    );

    if(!json){
        Logger.log(
            "❌ FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON 속성이 없습니다."
        );
        return null;
    }

    try{

        const serviceAccount = JSON.parse(json);

        const projectId = String(
            serviceAccount.project_id || ""
        ).trim();

        const clientEmail = String(
            serviceAccount.client_email || ""
        ).trim();

        const privateKey = String(
            serviceAccount.private_key || ""
        );

        Logger.log(
            "👑 관리자 Firebase Project = " + projectId
        );

        Logger.log(
            "👑 관리자 Firebase Service Account = " +
            clientEmail
        );

        if(projectId !== "adminapp-c5661"){

            Logger.log(
                "❌ 관리자 Firebase Project 불일치"
            );

            Logger.log(
                "❌ 기대값 = adminapp-c5661"
            );

            Logger.log(
                "❌ 실제값 = " + projectId
            );

            return null;
        }

        if(!clientEmail){

            Logger.log(
                "❌ 관리자 Firebase client_email 없음"
            );

            return null;
        }

        if(!privateKey){

            Logger.log(
                "❌ 관리자 Firebase private_key 없음"
            );

            return null;
        }

        const now = Math.floor(
            Date.now() / 1000
        );

        const header = {
            alg: "RS256",
            typ: "JWT"
        };

        const claimSet = {
            iss: clientEmail,
            scope:
                "https://www.googleapis.com/auth/firebase.messaging",
            aud:
                "https://oauth2.googleapis.com/token",
            iat: now,
            exp: now + 3600
        };

        const encodedHeader =
            Utilities
                .base64EncodeWebSafe(
                    JSON.stringify(header)
                )
                .replace(/=+$/, "");

        const encodedClaim =
            Utilities
                .base64EncodeWebSafe(
                    JSON.stringify(claimSet)
                )
                .replace(/=+$/, "");

        const unsignedToken =
            encodedHeader + "." + encodedClaim;

        const signature =
            Utilities.computeRsaSha256Signature(
                unsignedToken,
                privateKey
            );

        const encodedSignature =
            Utilities
                .base64EncodeWebSafe(signature)
                .replace(/=+$/, "");

        const jwt =
            unsignedToken + "." + encodedSignature;

        const response =
            UrlFetchApp.fetch(
                "https://oauth2.googleapis.com/token",
                {
                    method: "post",
                    contentType:
                        "application/x-www-form-urlencoded",
                    payload: {
                        grant_type:
                            "urn:ietf:params:oauth:grant-type:jwt-bearer",
                        assertion: jwt
                    },
                    muteHttpExceptions: true
                }
            );

        const responseCode =
            response.getResponseCode();

        const responseText =
            response.getContentText();

        if(responseCode !== 200){

            Logger.log(
                "❌ 관리자 Firebase OAuth 인증 실패"
            );

            Logger.log(
                "❌ HTTP = " + responseCode
            );

            Logger.log(
                "❌ 응답 = " + responseText
            );

            return null;
        }

        const result =
            JSON.parse(responseText);

        const accessToken =
            String(
                result.access_token || ""
            ).trim();

        if(!accessToken){

            Logger.log(
                "❌ 관리자 Firebase Access Token이 비어있습니다."
            );

            return null;
        }

        Logger.log(
            "✅ 관리자 Firebase Access Token 확보"
        );

        return accessToken;

    }catch(e){

        Logger.log(
            "❌ getAdminFirebaseAccessToken 오류 = " +
            e.toString()
        );

        return null;
    }
}

//==================================================
// 👑 MasterApp 전용 Firebase FCM HTTP v1 Access Token
// Firebase Project : masterapp-9a673
// Script Property : FIREBASE_MASTER_SERVICE_ACCOUNT_JSON
// ⚠️ 기사앱 / 관리자앱 FCM과 완전히 분리
//==================================================
function getMasterFirebaseAccessToken(){
  try{
    const properties=PropertiesService.getScriptProperties();
    const json=properties.getProperty("FIREBASE_MASTER_SERVICE_ACCOUNT_JSON");

    if(!json){
      Logger.log("❌ FIREBASE_MASTER_SERVICE_ACCOUNT_JSON 속성이 없습니다.");
      return null;
    }

    const serviceAccount=JSON.parse(json);
    const projectId=String(serviceAccount.project_id||"").trim();
    const clientEmail=String(serviceAccount.client_email||"").trim();
    const privateKey=String(serviceAccount.private_key||"");

    Logger.log("👑 MasterApp Firebase Project = "+projectId);
    Logger.log("👑 MasterApp Service Account = "+clientEmail);

    if(projectId!=="masterapp-9a673"){
      Logger.log("❌ MasterApp Firebase Project 불일치");
      Logger.log("❌ 기대값 = masterapp-9a673");
      Logger.log("❌ 실제값 = "+projectId);
      return null;
    }

    if(!clientEmail){
      Logger.log("❌ MasterApp client_email 없음");
      return null;
    }

    if(!privateKey){
      Logger.log("❌ MasterApp private_key 없음");
      return null;
    }

    const now=Math.floor(Date.now()/1000);
    const header={alg:"RS256",typ:"JWT"};
    const claimSet={
      iss:clientEmail,
      scope:"https://www.googleapis.com/auth/firebase.messaging",
      aud:"https://oauth2.googleapis.com/token",
      iat:now,
      exp:now+3600
    };

    const encodedHeader=Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/,"");
    const encodedClaim=Utilities.base64EncodeWebSafe(JSON.stringify(claimSet)).replace(/=+$/,"");
    const unsignedToken=encodedHeader+"."+encodedClaim;

    const signature=Utilities.computeRsaSha256Signature(unsignedToken,privateKey);
    const encodedSignature=Utilities.base64EncodeWebSafe(signature).replace(/=+$/,"");
    const jwt=unsignedToken+"."+encodedSignature;

    const response=UrlFetchApp.fetch("https://oauth2.googleapis.com/token",{
      method:"post",
      contentType:"application/x-www-form-urlencoded",
      payload:{
        grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion:jwt
      },
      muteHttpExceptions:true
    });

    const code=response.getResponseCode();
    const text=response.getContentText();

    Logger.log("📡 MasterApp OAuth HTTP = "+code);

    if(code!==200){
      Logger.log("❌ MasterApp Firebase OAuth 인증 실패 = "+text);
      return null;
    }

    const result=JSON.parse(text);
    const accessToken=String(result.access_token||"").trim();

    if(!accessToken){
      Logger.log("❌ MasterApp Access Token이 없습니다.");
      return null;
    }

    Logger.log("✅ MasterApp Firebase Access Token 생성 성공");
    return accessToken;

  }catch(e){
    Logger.log("❌ getMasterFirebaseAccessToken 오류 = "+e.toString());
    Logger.log(e.stack||"");
    return null;
  }
}

//==================================================
// 관리자 오더 이벤트 FCM
// ACCEPTED / REJECTED / COMPLETED
//==================================================
function notifyAdminsOrderEvent(eventType,orderId,driverId,orderData){
    try{
        Logger.log("========== [ADMIN EVENT START] ==========");
        Logger.log("eventType="+eventType+" / orderId="+orderId+" / driverId="+driverId);

        eventType=String(eventType||"").trim().toUpperCase();
        orderId=String(orderId||"").trim();
        driverId=String(driverId||"").trim();

        if(!orderData||!Array.isArray(orderData))orderData=[];

        const productName=String(orderData[ORDER_COL.PRODUCT]||"복합 배송").trim();
        const routeText=String(orderData[ORDER_COL.ROUTE]||"경로 정보 없음").trim();
        const driverName=getDriverNameById(driverId)||driverId||"미확인 기사";

        Logger.log("① 관리자 이벤트 정리 완료");
        Logger.log("product="+productName+" / driverName="+driverName);
        Logger.log("route="+routeText);

        let title="";
        let message="";
        let type="";

        if(eventType==="ACCEPTED"){
            title="📦 오더 수락";
            message="기사 "+driverName+"님이 오더를 수락했습니다.\n("+productName+")📍 "+routeText;
            type="ORDER_ACCEPTED";
        }else if(eventType==="REJECTED"){
            title="⚠️ 오더 거절";
            message="기사 "+driverName+"님이 오더를 거절했습니다.\n("+productName+")📍 "+routeText;
            type="ORDER_REJECTED";
        }else if(eventType==="COMPLETED"){
            title="✅ 배송 완료";
            message="기사 "+driverName+"님이 배송을 완료했습니다.\n("+productName+")📍 "+routeText;
            type="ORDER_COMPLETED";
        }else{
            Logger.log("❌ 알 수 없는 eventType="+eventType);
            return false;
        }

        Logger.log("② FCM 제목="+title);
        Logger.log("③ FCM type="+type);
        Logger.log("④ 관리자 전체 전송 함수 호출 직전");

        const result=broadcastFcmPushToAdmins(title,message,{
            orderId:orderId,
            type:type,
            driverId:driverId,
            driverName:driverName,
            productName:productName,
            route:routeText,
            timestamp:String(Date.now())
        });

        Logger.log("⑤ 관리자 전체 FCM 결과="+result);
        Logger.log("========== [ADMIN EVENT END] ==========");

        return result;

    }catch(e){
        Logger.log("❌ notifyAdminsOrderEvent 오류="+e.toString());
        Logger.log(e.stack||"");
        return false;
    }
}

//==================================================
// 👑 MasterApp 오더 이벤트 FCM
// ACCEPTED / REJECTED / COMPLETED
// 관리자계정_DB I열 = MasterApp FCM Token
//==================================================
function notifyMasterAppOrderEvent(eventType,orderId,driverId,orderData){
    try{
        Logger.log("========== [MASTER EVENT START] ==========");

        eventType=String(eventType||"").trim().toUpperCase();
        orderId=String(orderId||"").trim();
        driverId=String(driverId||"").trim();

        if(!orderData||!Array.isArray(orderData))orderData=[];

        const productName=String(orderData[ORDER_COL.PRODUCT]||"복합 배송").trim();
        const routeText=String(orderData[ORDER_COL.ROUTE]||"경로 정보 없음").trim();
        const driverName=getDriverNameById(driverId)||driverId||"미확인 기사";

        let title="";
        let message="";
        let type="";

        if(eventType==="ACCEPTED"){
            title="📦 기사 오더 수락";
            message="기사 "+driverName+"님이 오더를 수락했습니다.\n("+productName+")📍 "+routeText;
            type="ORDER_ACCEPTED";

        }else if(eventType==="REJECTED"){
            title="⚠️ 기사 오더 거절";
            message="기사 "+driverName+"님이 오더를 거절했습니다.\n("+productName+")📍 "+routeText;
            type="ORDER_REJECTED";

        }else if(eventType==="COMPLETED"){
            title="✅ 배송 완료";
            message="기사 "+driverName+"님이 배송을 완료했습니다.\n("+productName+")📍 "+routeText;
            type="ORDER_COMPLETED";

        }else{
            Logger.log("❌ MasterApp 알 수 없는 eventType = "+eventType);
            return false;
        }

        const result=broadcastFcmPushToMasterApps(
            title,
            message,
            {
                orderId:orderId,
                type:type,
                driverId:driverId,
                driverName:driverName,
                productName:productName,
                route:routeText,
                timestamp:String(Date.now())
            }
        );

        Logger.log("📡 MasterApp FCM 결과 = "+result);
        Logger.log("========== [MASTER EVENT END] ==========");

        return result;

    }catch(e){
        Logger.log("❌ notifyMasterAppOrderEvent 오류 = "+e.toString());
        Logger.log(e.stack||"");
        return false;
    }
}


//==================================================
// 👑 MasterApp 전체 FCM 발송
// 관리자계정_DB I열 사용
//==================================================
function broadcastFcmPushToMasterApps(title,body,extraData){
    try{
        Logger.log("========== [MASTER BROADCAST START] ==========");

        const sheet=getAdminSheet();

        if(!sheet){
            Logger.log("❌ 관리자계정_DB 시트를 찾을 수 없습니다.");
            return false;
        }

        const rows=sheet.getDataRange().getValues();

        if(!rows||rows.length<=1){
            Logger.log("⚠️ 관리자계정_DB 데이터 없음");
            return false;
        }

        const sentTokens={};
        let total=0;
        let tokenCount=0;
        let successCount=0;

        for(let i=1;i<rows.length;i++){
            try{
                const row=rows[i];

                if(!row)continue;

                total++;

                const accountId=String(row[ADMIN_COL.ID]||"").trim();
                const status=String(row[ADMIN_COL.STATUS]||"").trim();

                // I열 = MasterApp FCM Token
                const masterToken=String(row[8]||"").trim();

                Logger.log(
                    "③ MasterApp["+i+"] ID="+
                    accountId+
                    " / status="+
                    status+
                    " / token="+
                    (masterToken?"있음":"없음")
                );

                if(!accountId||status!=="사용"||!masterToken){
                    Logger.log("↪ MasterApp 전송 제외");
                    continue;
                }

                tokenCount++;

                if(sentTokens[masterToken]){
                    Logger.log("↪ 중복 MasterApp Token → 제외");
                    continue;
                }

                sentTokens[masterToken]=true;

                const result=sendFcmPushToMasterApp(
                    accountId,
                    title,
                    body,
                    extraData
                );

                Logger.log(
                    "④ MasterApp FCM 결과 / "+
                    accountId+
                    " = "+
                    result
                );

                if(result)successCount++;

            }catch(oneErr){
                Logger.log(
                    "❌ 개별 MasterApp FCM 오류 = "+
                    oneErr.toString()
                );
            }
        }

        Logger.log(
            "⑤ MasterApp 전체="+
            total+
            " / Token="+
            tokenCount+
            " / 성공="+
            successCount
        );

        Logger.log("========== [MASTER BROADCAST END] ==========");

        return successCount>0;

    }catch(e){
        Logger.log(
            "❌ broadcastFcmPushToMasterApps 오류 = "+
            e.toString()
        );

        Logger.log(e.stack||"");

        return false;
    }
}


//==================================================
// 👑 MasterApp 단일 FCM 발송
// Firebase Project = masterapp-9a673
// 관리자계정_DB I열 = MasterApp FCM Token
//==================================================
function sendFcmPushToMasterApp(
    accountId,
    title,
    body,
    extraData
){
    try{
        accountId=String(accountId||"").trim();
        title=String(title||"꽃배달 관제 알림").trim();
        body=String(body||"오더 상태가 변경되었습니다.").trim();
        extraData=extraData||{};

        if(!accountId){
            Logger.log("❌ MasterApp accountId 없음");
            return false;
        }

        const sheet=getAdminSheet();

        if(!sheet){
            Logger.log("❌ 관리자계정_DB 없음");
            return false;
        }

        const rows=sheet.getDataRange().getValues();

        let masterToken="";

        for(let i=1;i<rows.length;i++){

            const rowId=
                String(rows[i][ADMIN_COL.ID]||"").trim();

            if(rowId!==accountId)continue;

            const status=
                String(rows[i][ADMIN_COL.STATUS]||"").trim();

            if(status!=="사용"){
                Logger.log(
                    "⚠️ MasterApp 계정 사용상태 아님 = "+
                    status
                );
                return false;
            }

            // I열
            masterToken=
                String(rows[i][8]||"").trim();

            break;
        }

        if(!masterToken){
            Logger.log(
                "❌ MasterApp FCM Token 없음 = "+
                accountId
            );
            return false;
        }

        const accessToken=
            getMasterFirebaseAccessToken();

        if(!accessToken){
            Logger.log(
                "❌ MasterApp Firebase Access Token 실패"
            );
            return false;
        }

        const projectId=
            "masterapp-9a673";

        const url=
            "https://fcm.googleapis.com/v1/projects/"+
            projectId+
            "/messages:send";

        const dataPayload={
            title:title,
            message:body,
            timestamp:String(Date.now())
        };

        if(
            extraData &&
            typeof extraData==="object"
        ){
            for(const key in extraData){

                if(
                    Object.prototype
                        .hasOwnProperty
                        .call(extraData,key)
                ){
                    dataPayload[key]=
                        String(
                            extraData[key]===undefined||
                            extraData[key]===null
                                ? ""
                                : extraData[key]
                        );
                }
            }
        }

        if(!dataPayload.orderId){
            dataPayload.orderId=
                "UNKNOWN-"+Date.now();
        }

        if(!dataPayload.type){
            dataPayload.type=
                "MASTER_ORDER_EVENT";
        }

        const payload={
            message:{
                token:masterToken,
                data:dataPayload,
                android:{
                    priority:"HIGH"
                }
            }
        };

        Logger.log(
            "👑 MasterApp FCM 발송 시작"
        );

        Logger.log(
            "👑 accountId = "+
            accountId
        );

        Logger.log(
            "🔥 Token 길이 = "+
            masterToken.length
        );

        Logger.log(
            "📢 title = "+
            title
        );

        Logger.log(
            "📢 body = "+
            body
        );

        Logger.log(
            "📦 type = "+
            dataPayload.type
        );

        const response=
            UrlFetchApp.fetch(
                url,
                {
                    method:"post",
                    contentType:"application/json",
                    headers:{
                        Authorization:
                            "Bearer "+
                            accessToken
                    },
                    payload:
                        JSON.stringify(payload),
                    muteHttpExceptions:true
                }
            );

        const code=
            response.getResponseCode();

        const text=
            response.getContentText();

        Logger.log(
            "📡 MasterApp FCM HTTP = "+
            code
        );

        Logger.log(
            "📨 MasterApp FCM 응답 = "+
            text
        );

        if(code===200){
            Logger.log(
                "🎉 MasterApp FCM 전송 성공"
            );
            return true;
        }

        if(code===400){
            Logger.log(
                "🚨 MasterApp FCM 요청 오류"
            );
            return false;
        }

        if(code===401){
            Logger.log(
                "🚨 MasterApp Firebase 인증 오류"
            );
            return false;
        }

        if(code===403){
            Logger.log(
                "🚨 MasterApp Firebase 권한 오류"
            );
            return false;
        }

        Logger.log(
            "❌ MasterApp FCM 전송 실패 HTTP = "+
            code
        );

        return false;

    }catch(e){

        Logger.log(
            "❌ sendFcmPushToMasterApp 오류 = "+
            e.toString()
        );

        Logger.log(e.stack||"");

        return false;
    }
}

//==================================================
// 관리자 이름 조회
//==================================================
function getAdminNameById(accountId){
    try{
        accountId=String(accountId||"").trim();
        if(!accountId)return"";

        const sheet=getAdminSheet();
        const data=sheet.getDataRange().getValues();

        for(let i=1;i<data.length;i++){
            if(String(data[i][ADMIN_COL.ID]||"").trim()===accountId)return String(data[i][ADMIN_COL.NAME]||"").trim();
        }
    }catch(e){
        Logger.log("getAdminNameById 오류: "+e.toString());
    }

    return"";
}

//==================================================
// 기사 이름 조회
//==================================================
function getDriverNameById(driverId){
    try{
        driverId=String(driverId||"").trim();
        if(!driverId)return"";

        if(typeof findDriverRow==="function"){
            const driver=findDriverRow(driverId);
            if(driver&&driver.data&&DRIVER_COL&&DRIVER_COL.NAME!==undefined)return String(driver.data[DRIVER_COL.NAME]||"").trim();
        }

        const sheet=SpreadsheetApp.getActiveSpreadsheet().getSheetByName("기사상태_DB");
        if(!sheet)return"";

        const data=sheet.getDataRange().getValues();

        for(let i=1;i<data.length;i++){
            if(String(data[i][0]||"").trim()===driverId)return String(data[i][1]||"").trim();
        }
    }catch(e){
        Logger.log("getDriverNameById 오류: "+e.toString());
    }

    return"";
}

function broadcastFcmPushToAdmins(title,body,extraData){
    try{
        Logger.log("========== [ADMIN BROADCAST START] ==========");
        Logger.log("title="+title);
        Logger.log("body="+body);
        Logger.log("extraData="+JSON.stringify(extraData));

        const sheet=getAdminSheet();
        Logger.log("① 관리자 시트="+(sheet?"OK":"NULL"));

        const data=sheet.getDataRange().getValues();
        Logger.log("② 관리자 DB 행="+data.length);

        if(!data||data.length<=1){
            Logger.log("⚠️ 관리자 계정 데이터 없음");
            return false;
        }

        const sentTokens={};
        let total=0;
        let tokenCount=0;
        let successCount=0;

        for(let i=1;i<data.length;i++){
            try{
                const row=data[i];
                if(!row)continue;

                total++;

                const accountId=String(row[ADMIN_COL.ID]||"").trim();
                const status=String(row[ADMIN_COL.STATUS]||"").trim();
                const role=String(row[ADMIN_COL.ROLE]||"").trim().toUpperCase();
                const token=String(row[ADMIN_COL.FCM_TOKEN]||"").trim();

                Logger.log("③ 관리자["+i+"] ID="+accountId+" / status="+status+" / role="+role+" / token="+(token?"있음":"없음"));

                if(!accountId||status!=="사용"||!token){
                    Logger.log("↪ 관리자["+i+"] FCM 전송 제외");
                    continue;
                }

                tokenCount++;

                if(sentTokens[token]){
                    Logger.log("↪ 중복 Token → 제외");
                    continue;
                }

                sentTokens[token]=true;

                Logger.log("④ 관리자 FCM 실제 전송 시작 / accountId="+accountId);

                const sendResult=sendFcmPushToAdmin(accountId,title,body,extraData);

                Logger.log("⑤ 관리자 FCM 전송 결과 / accountId="+accountId+" / result="+sendResult);

                if(sendResult)successCount++;

            }catch(adminErr){
                Logger.log("❌ 개별 관리자 FCM 예외="+adminErr.toString());
                Logger.log(adminErr.stack||"");
            }
        }

        Logger.log("⑥ 관리자 FCM 전체="+total+" / Token="+tokenCount+" / 성공="+successCount);
        Logger.log("========== [ADMIN BROADCAST END] ==========");

        return successCount>0;

    }catch(e){
        Logger.log("❌ broadcastFcmPushToAdmins 오류="+e.toString());
        Logger.log(e.stack||"");
        return false;
    }
}

//==================================================
// 👑 관리자앱 FCM 단일 전송
//
// Firebase Project:
//     adminapp-c5661
//
// 관리자계정_DB:
//     H열 = FCM Token
//
// ⚠️ 기사앱용 Firebase 인증과 완전히 분리
//==================================================
function sendFcmPushToAdmin(
    accountId,
    title,
    body,
    extraData
){

    try{

        accountId =
            String(accountId || "").trim();

        title =
            String(title || "관리자 알림").trim();

        body =
            String(
                body ||
                "오더 상태가 변경되었습니다."
            ).trim();

        if(!accountId){

            Logger.log(
                "❌ 관리자 accountId 없음"
            );

            return false;
        }

        Logger.log(
            "========================================"
        );

        Logger.log(
            "📡 관리자 FCM 단일 전송 시작"
        );

        Logger.log(
            "👑 accountId = " + accountId
        );

        //==================================================
        // 관리자 계정 DB 조회
        //==================================================
        const sheet =
            getAdminSheet();

        if(!sheet){

            Logger.log(
                "❌ 관리자계정_DB 시트를 찾을 수 없습니다."
            );

            return false;
        }

        const rows =
            sheet.getDataRange().getValues();

        if(!rows || rows.length <= 1){

            Logger.log(
                "❌ 관리자계정_DB 데이터 없음"
            );

            return false;
        }

        let adminRow = -1;
        let fcmToken = "";

        for(let i = 1; i < rows.length; i++){

            const row =
                rows[i];

            const rowAccountId =
                String(
                    row[ADMIN_COL.ID] || ""
                ).trim();

            if(rowAccountId !== accountId){
                continue;
            }

            adminRow = i + 1;

            const status =
                String(
                    row[ADMIN_COL.STATUS] || ""
                ).trim();

            if(status !== "사용"){

                Logger.log(
                    "⚠️ 관리자 계정 사용 상태 아님 = " +
                    status
                );

                return false;
            }

            fcmToken =
                String(
                    row[ADMIN_COL.FCM_TOKEN] || ""
                ).trim();

            break;
        }

        if(adminRow < 0){

            Logger.log(
                "❌ 관리자 계정을 찾을 수 없음 = " +
                accountId
            );

            return false;
        }

        Logger.log(
            "📄 관리자 행 = " + adminRow
        );

        //==================================================
        // FCM Token 검증
        //==================================================
        if(!fcmToken){

            Logger.log(
                "❌ 관리자 FCM Token 없음 = " +
                accountId
            );

            return false;
        }

        if(typeof fcmToken !== "string"){

            Logger.log(
                "❌ FCM Token 타입 오류 = " +
                typeof fcmToken
            );

            return false;
        }

        Logger.log(
            "🔑 Token 앞부분 = " +
            fcmToken.substring(
                0,
                Math.min(20, fcmToken.length)
            ) +
            "..."
        );

        Logger.log(
            "🔑 Token 뒷부분 = ..." +
            fcmToken.substring(
                Math.max(
                    0,
                    fcmToken.length - 20
                )
            )
        );

        Logger.log(
            "🔢 Token 길이 = " +
            fcmToken.length
        );

        //==================================================
        // 👑 관리자앱 전용 Access Token
        //==================================================
        const accessToken =
            getAdminFirebaseAccessToken();

        if(!accessToken){

            Logger.log(
                "❌ 관리자 Firebase Access Token 확보 실패"
            );

            return false;
        }

        //==================================================
        // 👑 관리자앱 Firebase 프로젝트
        //==================================================
        const projectId =
            "adminapp-c5661";

        const url =
            "https://fcm.googleapis.com/v1/projects/" +
            projectId +
            "/messages:send";

        Logger.log(
            "🔥 Firebase Project = " +
            projectId
        );

        Logger.log(
            "🌐 FCM URL = " +
            url
        );

        //==================================================
        // Data Payload
        //==================================================
        const dataPayload = {

            title: title,

            message: body,

            timestamp:
                String(Date.now())
        };

        //==================================================
        // 추가 데이터
        //==================================================
        if(
            extraData &&
            typeof extraData === "object"
        ){

            for(
                const key in extraData
            ){

                if(
                    Object.prototype
                        .hasOwnProperty
                        .call(
                            extraData,
                            key
                        )
                ){

                    dataPayload[key] =
                        String(
                            extraData[key] ?? ""
                        );
                }
            }
        }

        //==================================================
        // 기본 데이터 보정
        //==================================================
        if(!dataPayload.orderId){

            dataPayload.orderId =
                "UNKNOWN-" +
                Date.now();
        }

        if(!dataPayload.type){

            dataPayload.type =
                "ADMIN_ORDER_EVENT";
        }

        // collapse_key는 FCM data payload가 아니라
        // Android message 옵션에 넣는 것이 맞으므로
        // 여기서는 넣지 않습니다.
        delete dataPayload.collapse_key;

        //==================================================
        // FCM HTTP v1 요청
        //==================================================
        const payload = {

            message: {

                token: fcmToken,

                data: dataPayload,

                android: {

                    priority: "HIGH"
                }
            }
        };

        Logger.log(
            "📤 관리자 FCM 요청 생성 완료"
        );

        Logger.log(
            "📦 orderId = " +
            dataPayload.orderId
        );

        Logger.log(
            "📦 type = " +
            dataPayload.type
        );

        //==================================================
        // HTTP 요청
        //==================================================
        const options = {

            method: "post",

            contentType:
                "application/json",

            headers: {

                Authorization:
                    "Bearer " +
                    accessToken
            },

            payload:
                JSON.stringify(payload),

            muteHttpExceptions:
                true
        };

        const response =
            UrlFetchApp.fetch(
                url,
                options
            );

        const code =
            response.getResponseCode();

        const text =
            response.getContentText();

        Logger.log(
            "📡 관리자 FCM HTTP 응답 = " +
            code
        );

        Logger.log(
            "📥 관리자 FCM 실제 응답 = " +
            text
        );

        //==================================================
        // 성공
        //==================================================
        if(code === 200){

            Logger.log(
                "🎉 관리자 FCM 전송 성공"
            );

            Logger.log(
                "========================================"
            );

            return true;
        }

        //==================================================
        // 권한 오류
        //==================================================
        if(code === 403){

            Logger.log(
                "🚨 관리자 Firebase 권한 오류"
            );

            Logger.log(
                "🚨 adminapp-c5661 서비스 계정에 " +
                "cloudmessaging.messages.create 권한이 필요합니다."
            );

            return false;
        }

        //==================================================
        // 잘못된 Token
        //==================================================
        if(code === 400){

            Logger.log(
                "🚨 관리자 FCM 요청 오류"
            );

            Logger.log(
                "🚨 Token 또는 payload를 확인해야 합니다."
            );

            return false;
        }

        //==================================================
        // 인증 오류
        //==================================================
        if(code === 401){

            Logger.log(
                "🚨 관리자 Firebase Access Token 인증 실패"
            );

            return false;
        }

        Logger.log(
            "❌ 관리자 FCM 전송 실패 HTTP = " +
            code
        );

        Logger.log(
            "========================================"
        );

        return false;

    }catch(e){

        Logger.log(
            "❌ sendFcmPushToAdmin 오류 = " +
            e.toString()
        );

        Logger.log(
            e.stack || ""
        );

        return false;
    }
}

//==================================================
// Firebase FCM HTTP v1 Access Token 생성
//==================================================
function getFirebaseAccessToken(){
    const properties=PropertiesService.getScriptProperties();
    const json=properties.getProperty("FIREBASE_SERVICE_ACCOUNT_JSON");

    if(!json){
        Logger.log("❌ FIREBASE_SERVICE_ACCOUNT_JSON 속성이 없습니다.");
        return null;
    }

    try{
        const serviceAccount=JSON.parse(json);
        const clientEmail=String(serviceAccount.client_email||"").trim();
        const privateKey=String(serviceAccount.private_key||"");

        if(!clientEmail||!privateKey)return null;

        const now=Math.floor(Date.now()/1000);
        const header={alg:"RS256",typ:"JWT"};
        const claimSet={iss:clientEmail,scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600};

        const encodedHeader=Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/,"");
        const encodedClaim=Utilities.base64EncodeWebSafe(JSON.stringify(claimSet)).replace(/=+$/,"");
        const unsignedToken=encodedHeader+"."+encodedClaim;
        const signature=Utilities.computeRsaSha256Signature(unsignedToken,privateKey);
        const encodedSignature=Utilities.base64EncodeWebSafe(signature).replace(/=+$/,"");
        const jwt=unsignedToken+"."+encodedSignature;

        const response=UrlFetchApp.fetch("https://oauth2.googleapis.com/token",{
            method:"post",
            contentType:"application/x-www-form-urlencoded",
            payload:{grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:jwt},
            muteHttpExceptions:true
        });

        if(response.getResponseCode()!==200){
            Logger.log("❌ Firebase OAuth 인증 실패 = "+response.getContentText());
            return null;
        }

        const result=JSON.parse(response.getContentText());
        return result.access_token||null;
    }catch(e){
        Logger.log("❌ Firebase Access Token 생성 오류: "+e.toString());
        return null;
    }
}

//==================================================
// 기존 JWT 서명 함수 호환 유지
//==================================================
function createJwt(clientEmail,privateKey,scope){
    const header={alg:"RS256",typ:"JWT"};
    const now=Math.floor(Date.now()/1000);
    const exp=now+3600;
    const payload={iss:clientEmail,scope:scope,aud:"https://oauth2.googleapis.com/token",iat:now,exp:exp};
    const toSign=Utilities.base64EncodeWebSafe(JSON.stringify(header))+"."+Utilities.base64EncodeWebSafe(JSON.stringify(payload));
    const signature=Utilities.computeRsaSignature(toSign,privateKey,Utilities.Digest_SHA_256);
    return toSign+"."+Utilities.base64EncodeWebSafe(signature);
}

//==================================================
// 외부 요청 권한 확인
//==================================================
function authorizeExternalRequest(){
    const response=UrlFetchApp.fetch("https://www.google.com");
    Logger.log("외부 요청 권한 확인 = HTTP "+response.getResponseCode());
}

//==================================================
// 👑 관리자 FCM 테스트
//==================================================
function testAdminFcm(){

    Logger.log(
        "========================================"
    );

    Logger.log(
        "👑 관리자 FCM 테스트 시작"
    );

    const result =
        sendFcmPushToAdmin(
            "Aa",
            "🔔 관리자 FCM 테스트",
            "마스터앱 FCM 연결 테스트입니다.",
            {
                orderId: "TEST-ADMIN-001",
                type: "ORDER_ACCEPTED",
                driverId: "TEST_DRIVER",
                driverName: "테스트 기사",
                productName: "테스트 상품",
                route: "서울 → 경기",
                timestamp: String(Date.now())
            }
        );

    Logger.log(
        "🔥 테스트 결과 = " +
        result
    );

    Logger.log(
        "========================================"
    );
}

function checkFirebaseServiceAccount(){
    const json=PropertiesService
        .getScriptProperties()
        .getProperty("FIREBASE_SERVICE_ACCOUNT_JSON");

    if(!json){
        Logger.log("❌ FIREBASE_SERVICE_ACCOUNT_JSON 없음");
        return;
    }

    const serviceAccount=JSON.parse(json);

    Logger.log(
        "🔥 현재 GAS가 사용하는 Firebase 서비스 계정 = " +
        String(serviceAccount.client_email||"")
    );

    Logger.log(
        "🔥 Firebase project_id = " +
        String(serviceAccount.project_id||"")
    );
}

//==================================================
// 👑 MasterApp Firebase 인증 테스트
//==================================================
function testMasterFirebaseAuth(){

  Logger.log(
    "========================================"
  );

  Logger.log(
    "👑 MasterApp Firebase 인증 테스트 시작"
  );

  const token=
    getMasterFirebaseAccessToken();

  if(token){

    Logger.log(
      "🎉 MasterApp Firebase 인증 성공"
    );

    Logger.log(
      "🔑 Access Token 길이 = "+
      token.length
    );

  }else{

    Logger.log(
      "❌ MasterApp Firebase 인증 실패"
    );
  }

  Logger.log(
    "========================================"
  );
}

//==================================================
// 👑 MasterApp 전용 FCM 발송
// Firebase Project : masterapp-9a673
// Token : 관리자계정_DB I열
// ⚠️ 기사앱 / 관리자앱 FCM과 완전히 분리
//==================================================
function sendMasterAppFcmPush(adminId,title,body,dataPayload){
  try{
    adminId=String(adminId||"").trim();
    title=String(title||"").trim();
    body=String(body||"").trim();
    dataPayload=dataPayload||{};

    if(!adminId){
      return {success:false,error:"관리자 ID가 없습니다."};
    }

    const ss=SpreadsheetApp.getActiveSpreadsheet();
    const sheet=ss.getSheetByName("관리자계정_DB");

    if(!sheet){
      return {success:false,error:"관리자계정_DB 시트를 찾을 수 없습니다."};
    }

    const values=sheet.getDataRange().getValues();

    if(!values||values.length<=1){
      return {success:false,error:"관리자계정_DB 데이터가 없습니다."};
    }

    let rowIndex=-1;

    for(let i=1;i<values.length;i++){
      if(String(values[i][0]||"").trim()===adminId){
        rowIndex=i+1;
        break;
      }
    }

    if(rowIndex===-1){
      return {success:false,error:"관리자 ID를 찾을 수 없습니다: "+adminId};
    }

    // I열 = MasterApp FCM Token
    const fcmToken=String(sheet.getRange(rowIndex,9).getValue()||"").trim();

    if(!fcmToken){
      return {
        success:false,
        error:"MasterApp FCM Token이 없습니다.",
        adminId:adminId,
        row:rowIndex
      };
    }

    const accessToken=getMasterFirebaseAccessToken();

    if(!accessToken){
      return {
        success:false,
        error:"MasterApp Firebase Access Token 생성 실패"
      };
    }

    const projectId="masterapp-9a673";

    const cleanData={};

    Object.keys(dataPayload).forEach(function(key){
      cleanData[String(key)]=String(dataPayload[key]===undefined||dataPayload[key]===null?"":dataPayload[key]);
    });

    const payload={
      message:{
        token:fcmToken,
        notification:{
          title:title||"꽃배달 관제 알림",
          body:body||"새로운 알림이 있습니다."
        },
        data:cleanData,
        android:{
          priority:"HIGH"
        }
      }
    };

    const url="https://fcm.googleapis.com/v1/projects/"+projectId+"/messages:send";

    Logger.log("========================================");
    Logger.log("👑 MasterApp FCM 발송 시작");
    Logger.log("👑 관리자 ID = "+adminId);
    Logger.log("🔥 Token 길이 = "+fcmToken.length);
    Logger.log("📢 제목 = "+title);
    Logger.log("📢 내용 = "+body);

    const response=UrlFetchApp.fetch(url,{
      method:"post",
      contentType:"application/json; charset=UTF-8",
      headers:{
        Authorization:"Bearer "+accessToken
      },
      payload:JSON.stringify(payload),
      muteHttpExceptions:true
    });

    const code=response.getResponseCode();
    const text=response.getContentText();

    Logger.log("📡 MasterApp FCM HTTP = "+code);
    Logger.log("📨 MasterApp FCM 응답 = "+text);
    Logger.log("========================================");

    if(code>=200&&code<300){
      return {
        success:true,
        adminId:adminId,
        row:rowIndex,
        message:"MasterApp FCM 발송 성공",
        response:text
      };
    }

    return {
      success:false,
      adminId:adminId,
      row:rowIndex,
      error:"MasterApp FCM 발송 실패",
      httpCode:code,
      response:text
    };

  }catch(e){
    Logger.log("❌ sendMasterAppFcmPush 오류 = "+e.toString());
    Logger.log(e.stack||"");

    return {
      success:false,
      error:e.toString()
    };
  }
}

function testMasterFirebaseAccessToken(){
  Logger.log("========================================");
  Logger.log("👑 MasterApp Firebase 인증 테스트 시작");
  const accessToken=getMasterFirebaseAccessToken();
  if(accessToken){
    Logger.log("✅ MasterApp Firebase 인증 성공");
    Logger.log("🔥 Access Token 길이 = "+accessToken.length);
  }else{
    Logger.log("❌ MasterApp Firebase 인증 실패");
  }
  Logger.log("========================================");
}

//==================================================
// 👑 MasterApp FCM 실제 발송 테스트
//==================================================
function testMasterAppFcmPush(){
  const adminId="Zz";

  Logger.log("========================================");
  Logger.log("👑 MasterApp FCM 실제 발송 테스트 시작");
  Logger.log("👑 대상 관리자 ID = "+adminId);

  const result=sendMasterAppFcmPush(
    adminId,
    "👑 MasterApp 테스트 알림",
    "MasterApp FCM 푸시 테스트가 정상적으로 도착했습니다.",
    {
      type:"MASTER_FCM_TEST",
      messageType:"TEST",
      timestamp:String(Date.now())
    }
  );

  Logger.log("📨 최종 결과 = "+JSON.stringify(result));
  Logger.log("========================================");

  return result;
}

//==================================================
// System Log
//==================================================
Logger.log("ORDER ENGINE ULTIMATE v7 READY");