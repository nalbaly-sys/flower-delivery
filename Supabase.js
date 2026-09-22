// ============================================================
// Supabase 연결 및 기본 API 모듈
// 꽃배달 시스템 - 1단계 연결 테스트용
// ============================================================

function getSupabaseConfig(){
    const props=PropertiesService.getScriptProperties();

    const url=String(props.getProperty("SUPABASE_URL")||"").trim();
    const secretKey=String(props.getProperty("SUPABASE_SECRET_KEY")||"").trim();

    if(!url){
        throw new Error("SUPABASE_URL이 설정되지 않았습니다.");
    }

    if(!secretKey){
        throw new Error("SUPABASE_SECRET_KEY가 설정되지 않았습니다.");
    }

    return{
        url:url.replace(/\/+$/,""),
        secretKey:secretKey
    };
}


// ============================================================
// Supabase REST API 공통 요청
// ============================================================

function supabaseRequest(path,method,payload){
    const config=getSupabaseConfig();

    method=String(method||"GET").toUpperCase();

    const options={
        method:method,
        muteHttpExceptions:true,
        headers:{
            "apikey":config.secretKey,
            "Authorization":"Bearer "+config.secretKey,
            "Content-Type":"application/json",
            "Prefer":"return=representation"
        }
    };

    if(payload!==undefined&&payload!==null){
        options.payload=JSON.stringify(payload);
    }

    const response=UrlFetchApp.fetch(
        config.url+"/rest/v1/"+String(path||"").replace(/^\/+/,""),
        options
    );

    const code=response.getResponseCode();
    const text=response.getContentText();

    Logger.log("===== SUPABASE RESPONSE =====");
    Logger.log("HTTP CODE = "+code);
    Logger.log("BODY = "+text);
    Logger.log("=============================");

    if(code<200||code>=300){
        throw new Error(
            "Supabase API 오류 ["+code+"]\n"+text
        );
    }

    if(!text){
        return null;
    }

    try{
        return JSON.parse(text);
    }catch(e){
        return text;
    }
}


// ============================================================
// Supabase 연결 테스트
// drivers 테이블에 GET 요청
// ============================================================

function testSupabaseConnection(){
    try{
        const result=supabaseRequest(
            "drivers?select=id,driver_id&limit=1",
            "GET"
        );

        Logger.log("========================================");
        Logger.log("✅ SUPABASE 연결 성공");
        Logger.log("drivers 조회 결과:");
        Logger.log(JSON.stringify(result));
        Logger.log("========================================");

        return{
            success:true,
            message:"Supabase 연결 성공",
            data:result
        };

    }catch(e){
        Logger.log("========================================");
        Logger.log("❌ SUPABASE 연결 실패");
        Logger.log(e.toString());
        Logger.log("========================================");

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}


// ============================================================
// drivers 테이블 구조 확인
// ============================================================

function testSupabaseDriversTable(){
    try{
        const result=supabaseRequest(
            "drivers?select=*%26limit=1",
            "GET"
        );

        Logger.log("drivers 테이블 조회 성공");
        Logger.log(JSON.stringify(result));

        return result;

    }catch(e){
        Logger.log("drivers 테이블 조회 실패: "+e.toString());
        return{
            success:false,
            message:e.message||String(e)
        };
    }
}


// ============================================================
// Date → ISO 문자열 변환
// ============================================================

function supabaseDateValue(value){
    if(value===null||value===undefined||value===""){
        return null;
    }

    if(Object.prototype.toString.call(value)==="[object Date]"){
        if(isNaN(value.getTime())){
            return null;
        }

        return value.toISOString();
    }

    const text=String(value).trim();

    if(!text){
        return null;
    }

    return text;
}


// ============================================================
// 기사상태_DB 한 줄 → Supabase drivers 변환
// 아직 실제 동기화에는 사용하지 않음
// 다음 단계에서 사용
// ============================================================

function convertDriverSheetRowToSupabase(row){
    if(!Array.isArray(row)){
        throw new Error("기사 데이터가 올바르지 않습니다.");
    }

    return{
        driver_id:String(row[0]||"").trim(),
        name:String(row[1]||"").trim(),
        phone:String(row[2]||"").trim(),
        work_status:String(row[3]||"").trim()||"퇴근함",
        last_access:supabaseDateValue(row[4]),
        latitude:row[5]!==""&&row[5]!==null&&row[5]!==undefined
            ?Number(row[5])
            :null,
        longitude:row[6]!==""&&row[6]!==null&&row[6]!==undefined
            ?Number(row[6])
            :null,
        gps_time:supabaseDateValue(row[7]),
        password:String(row[8]||"").trim(),
        fcm_token:String(row[9]||"").trim()
    };
}


// ============================================================
// 기사 1명 Supabase 저장
// 다음 단계에서 실제 사용
// ============================================================

function upsertDriverToSupabase(driverData){
    if(!driverData||!driverData.driver_id){
        throw new Error("driver_id가 없습니다.");
    }

    return supabaseRequest(
        "drivers?on_conflict=driver_id",
        "POST",
        driverData
    );
}


// ============================================================
// Supabase drivers 전체 조회
// ============================================================

function getSupabaseDrivers(){
    return supabaseRequest(
        "drivers?select=*%26order=id.asc",
        "GET"
    );
}


// ============================================================
// Supabase orders 전체 조회
// ============================================================

function getSupabaseOrders(){
    return supabaseRequest(
        "orders?select=*%26order=id.asc",
        "GET"
    );
}


// ============================================================
// Supabase 관리자계정 전체 조회
// ============================================================

function getSupabaseAdminAccounts(){
    return supabaseRequest(
        "admin_accounts?select=*%26order=id.asc",
        "GET"
    );
}

// ============================================================
// 기사상태_DB → Supabase drivers 초기 데이터 이관
// 기존 Google Sheet 데이터는 절대 수정하지 않음
// ============================================================

function syncAllDriversToSupabase(){
    try{
        Logger.log("========================================");
        Logger.log("🚚 기사 데이터 Supabase 초기 이관 시작");
        Logger.log("========================================");

        let sheet=null;

        // 기존 프로젝트의 getDriverSheet()가 있으면 우선 사용
        if(typeof getDriverSheet==="function"){
            sheet=getDriverSheet();
        }

        // 혹시 getDriverSheet()가 없는 경우 시트 이름으로 직접 찾음
        if(!sheet){
            const ss=SpreadsheetApp.getActiveSpreadsheet();
            if(ss){
                sheet=ss.getSheetByName("기사상태_DB");
            }
        }

        if(!sheet){
            throw new Error("기사상태_DB 시트를 찾을 수 없습니다.");
        }

        const data=sheet.getDataRange().getValues();

        if(!data||data.length<=1){
            Logger.log("기사 데이터가 없습니다.");
            return{
                success:true,
                count:0,
                message:"기사 데이터가 없습니다."
            };
        }

        const drivers=[];

        for(let i=1;i<data.length;i++){
            const row=data[i];

            if(!row)continue;

            const driverId=String(row[0]||"").trim();

            // 기사ID가 없는 빈 행은 건너뜀
            if(!driverId)continue;

            const driverData={
                driver_id:driverId,
                name:String(row[1]||"").trim(),
                phone:String(row[2]||"").trim(),
                work_status:String(row[3]||"").trim()||"퇴근함",
                last_access:supabaseDateValue(row[4]),

                latitude:
                    row[5]!==""&&
                    row[5]!==null&&
                    row[5]!==undefined&&
                    !isNaN(Number(row[5]))
                    ?Number(row[5])
                    :null,

                longitude:
                    row[6]!==""&&
                    row[6]!==null&&
                    row[6]!==undefined&&
                    !isNaN(Number(row[6]))
                    ?Number(row[6])
                    :null,

                gps_time:supabaseDateValue(row[7]),
                password:String(row[8]||"").trim(),
                fcm_token:String(row[9]||"").trim()
            };

            drivers.push(driverData);

            Logger.log(
                "기사 "+drivers.length+
                " : "+driverId+
                " / "+driverData.name+
                " / "+driverData.work_status
            );
        }

        if(drivers.length===0){
            Logger.log("이관할 기사가 없습니다.");

            return{
                success:true,
                count:0,
                message:"이관할 기사가 없습니다."
            };
        }

        Logger.log("----------------------------------------");
        Logger.log("Supabase drivers 업로드 시작");
        Logger.log("대상 기사 수 = "+drivers.length);
        Logger.log("----------------------------------------");

        const result=supabaseRequest(
            "drivers?on_conflict=driver_id",
            "POST",
            drivers
        );

        Logger.log("========================================");
        Logger.log("✅ 기사 데이터 이관 완료");
        Logger.log("이관 기사 수 = "+drivers.length);
        Logger.log("Supabase 응답 = "+JSON.stringify(result));
        Logger.log("========================================");

        return{
            success:true,
            count:drivers.length,
            data:result,
            message:drivers.length+"명의 기사 데이터를 Supabase로 이관했습니다."
        };

    }catch(e){

        Logger.log("========================================");
        Logger.log("❌ 기사 데이터 이관 실패");
        Logger.log(e.toString());
        Logger.log("========================================");

        return{
            success:false,
            count:0,
            message:e.message||String(e)
        };
    }
}


// ============================================================
// Supabase drivers 데이터 확인용
// ============================================================

function testSupabaseDriversData(){
    try{
        const result=supabaseRequest(
            "drivers?select=id,driver_id,name,phone,work_status,latitude,longitude,gps_time&order=id.asc",
            "GET"
        );

        Logger.log("========================================");
        Logger.log("📋 Supabase drivers 현재 데이터");
        Logger.log("기사 수 = "+(Array.isArray(result)?result.length:0));
        Logger.log(JSON.stringify(result));
        Logger.log("========================================");

        return result;

    }catch(e){

        Logger.log("❌ drivers 데이터 조회 실패");
        Logger.log(e.toString());

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

//==================================================
// 기사 GPS / 기사정보 Supabase 동기화
// 최신 GPS 시간 우선 반영 버전
//==================================================
function syncDriverToSupabase(driverId,data){
    const diagnostic={
        time:new Date().toISOString(),
        driverId:String(driverId||"").trim(),
        data:data||{},
        success:false,
        skipped:false,
        reason:"",
        result:null,
        current:null,
        error:""
    };

    try{
        driverId=String(driverId||"").trim();
        diagnostic.driverId=driverId;

        if(!driverId){
            diagnostic.error="driverId 없음";
            saveGpsSupabaseDiagnosticByDriver(diagnostic);
            return false;
        }

        if(!data||typeof data!=="object"){
            diagnostic.error="데이터 없음";
            saveGpsSupabaseDiagnosticByDriver(diagnostic);
            return false;
        }

        const updateData=Object.assign({},data);
        delete updateData.driver_id;
        diagnostic.data=updateData;

        //==================================================
        // GPS 시간 데이터가 있는 경우
        //==================================================
        if(updateData.gps_time!==undefined&&updateData.gps_time!==null&&String(updateData.gps_time).trim()!==""){
            const incomingTime=new Date(String(updateData.gps_time));

            if(isNaN(incomingTime.getTime())){
                diagnostic.error="잘못된 gps_time = "+String(updateData.gps_time);
                saveGpsSupabaseDiagnosticByDriver(diagnostic);
                Logger.log("❌ 잘못된 GPS 시간 = "+String(updateData.gps_time));
                return false;
            }

            const incomingISO=incomingTime.toISOString();

            Logger.log("==================================================");
            Logger.log("📡 Supabase GPS 최신시간 비교");
            Logger.log("driverId = "+driverId);
            Logger.log("incoming GPS = "+incomingISO);
            Logger.log("incoming LAT = "+updateData.latitude);
            Logger.log("incoming LNG = "+updateData.longitude);

            //==================================================
            // 1. 현재 Supabase GPS 확인
            //==================================================
            const checkPath="drivers?driver_id=eq."+encodeURIComponent(driverId)+"&select=driver_id,work_status,latitude,longitude,gps_time";
            const currentResult=supabaseRequest(checkPath,"GET");

            diagnostic.current=currentResult;

            if(!Array.isArray(currentResult)||currentResult.length===0){
                diagnostic.error="Supabase에서 기사를 찾을 수 없습니다.";
                diagnostic.reason="DRIVER_NOT_FOUND";
                saveGpsSupabaseDiagnosticByDriver(diagnostic);
                Logger.log("❌ Supabase 기사 없음 = "+driverId);
                return false;
            }

            const current=currentResult[0];
            const currentGpsTime=current.gps_time?new Date(String(current.gps_time)):null;

            Logger.log("현재 Supabase GPS = "+JSON.stringify(current));

            //==================================================
            // 2. 기존 GPS 시간과 비교
            //==================================================
            if(currentGpsTime&&!isNaN(currentGpsTime.getTime())){
                Logger.log("현재 Supabase GPS TIME = "+currentGpsTime.toISOString());
                Logger.log("새 GPS TIME = "+incomingISO);

                if(incomingTime.getTime()<=currentGpsTime.getTime()){
                    diagnostic.success=true;
                    diagnostic.skipped=true;
                    diagnostic.reason="STALE_GPS_SKIPPED";

                    saveGpsSupabaseDiagnosticByDriver(diagnostic);

                    Logger.log("⏩ 오래된 GPS라 Supabase 업데이트 생략");
                    Logger.log("==================================================");

                    return true;
                }
            }else{
                Logger.log("ℹ️ Supabase 기존 GPS 시간이 없어서 최신 GPS 반영");
            }

            //==================================================
            // 3. 최신 GPS만 Supabase PATCH
            //==================================================
            const path="drivers?driver_id=eq."+encodeURIComponent(driverId);

            Logger.log("📤 최신 GPS Supabase PATCH 시작");

            const result=supabaseRequest(path,"PATCH",updateData);

            diagnostic.result=result;

            if(!Array.isArray(result)||result.length===0){
                diagnostic.error="PATCH 후 수정된 행이 없습니다.";
                diagnostic.reason="PATCH_NO_ROW";
                saveGpsSupabaseDiagnosticByDriver(diagnostic);

                Logger.log("❌ Supabase PATCH 수정 행 없음");
                Logger.log("==================================================");

                return false;
            }

            //==================================================
            // 4. PATCH 결과 검증
            //==================================================
            const saved=result[0];
            const savedGpsTime=saved.gps_time?new Date(String(saved.gps_time)):null;

            if(savedGpsTime&&!isNaN(savedGpsTime.getTime())){
                if(savedGpsTime.getTime()!==incomingTime.getTime()){
                    diagnostic.error="PATCH 결과 GPS 시간이 예상값과 다름";
                    diagnostic.reason="PATCH_TIME_MISMATCH";
                    saveGpsSupabaseDiagnosticByDriver(diagnostic);

                    Logger.log("⚠️ PATCH 결과 GPS TIME 불일치");
                    Logger.log("예상 = "+incomingISO);
                    Logger.log("실제 = "+savedGpsTime.toISOString());
                    Logger.log("==================================================");

                    return false;
                }
            }

            diagnostic.success=true;
            diagnostic.skipped=false;
            diagnostic.reason="GPS_UPDATED";

            saveGpsSupabaseDiagnosticByDriver(diagnostic);

            Logger.log("✅ 최신 GPS Supabase 반영 성공");
            Logger.log("driverId = "+driverId);
            Logger.log("latitude = "+updateData.latitude);
            Logger.log("longitude = "+updateData.longitude);
            Logger.log("gps_time = "+incomingISO);
            Logger.log("==================================================");

            return true;
        }

        //==================================================
        // GPS 시간이 없는 일반 기사정보 업데이트
        //==================================================
        const normalPath="drivers?driver_id=eq."+encodeURIComponent(driverId);

        const normalResult=supabaseRequest(normalPath,"PATCH",updateData);

        diagnostic.result=normalResult;

        if(!Array.isArray(normalResult)||normalResult.length===0){
            diagnostic.error="수정된 행이 없습니다.";
            diagnostic.reason="DRIVER_UPDATE_NO_ROW";
            saveGpsSupabaseDiagnosticByDriver(diagnostic);
            return false;
        }

        diagnostic.success=true;
        diagnostic.reason="DRIVER_UPDATED";

        saveGpsSupabaseDiagnosticByDriver(diagnostic);

        Logger.log("✅ Supabase 기사정보 동기화 완료 = "+driverId);

        return true;

    }catch(e){
        diagnostic.success=false;
        diagnostic.error=e.message||String(e);
        diagnostic.reason="EXCEPTION";

        saveGpsSupabaseDiagnosticByDriver(diagnostic);

        Logger.log("❌ Supabase 기사 동기화 실패 = "+e.toString());
        Logger.log("❌ stack = "+(e.stack||"stack 없음"));

        return false;
    }
}

function saveGpsSupabaseDiagnosticByDriver(data){
    try{
        const driverId=
            String(data.driverId||"").trim();

        if(!driverId)return;

        const props=
            PropertiesService.getScriptProperties();

        const key=
            "GPS_SUPABASE_DIAGNOSTIC_"+
            encodeURIComponent(driverId);

        props.setProperty(
            key,
            JSON.stringify(data)
        );

        // 기존 마지막 진단도 유지
        props.setProperty(
            "LAST_GPS_SUPABASE_DIAGNOSTIC",
            JSON.stringify(data)
        );

    }catch(e){

        Logger.log(
            "⚠️ 기사별 GPS 진단 저장 실패: "+
            e.toString()
        );
    }
}

function getAllGpsSupabaseDiagnostics(){

    try{

        Logger.log("========================================");
        Logger.log("📊 기사별 GPS Supabase 전체 진단");
        Logger.log("========================================");

        const sheet=getDriverSheet();

        if(!sheet){
            Logger.log("❌ 기사상태_DB를 찾을 수 없습니다.");
            return{
                success:false,
                message:"기사상태_DB를 찾을 수 없습니다."
            };
        }

        const data=sheet.getDataRange().getValues();

        if(!data||data.length<=1){
            Logger.log("❌ 기사 데이터가 없습니다.");
            return{
                success:false,
                message:"기사 데이터가 없습니다."
            };
        }

        const props=
            PropertiesService.getScriptProperties();

        const result=[];

        let total=0;
        let successCount=0;
        let failCount=0;
        let noDiagnosticCount=0;

        for(let i=1;i<data.length;i++){

            const row=data[i];

            if(!row)continue;

            const driverId=
                String(row[DRIVER_COL.ID]||"").trim();

            if(!driverId)continue;

            total++;

            const key=
                "GPS_SUPABASE_DIAGNOSTIC_"+
                encodeURIComponent(driverId);

            const json=
                props.getProperty(key);

            if(!json){

                noDiagnosticCount++;

                result.push({
                    driver_id:driverId,
                    diagnostic_status:"⚪ 진단없음",
                    diagnostic:null
                });

                continue;
            }

            let diagnostic=null;

            try{
                diagnostic=JSON.parse(json);
            }catch(e){

                diagnostic={
                    success:false,
                    driverId:driverId,
                    error:"진단 데이터 JSON 오류"
                };
            }

            if(diagnostic.success){
                successCount++;
            }else{
                failCount++;
            }

            result.push({
                driver_id:driverId,
                diagnostic_status:
                    diagnostic.success
                    ?"✅ 성공"
                    :"❌ 실패",
                diagnostic:diagnostic
            });
        }

        Logger.log("========================================");
        Logger.log("📊 전체 진단 요약");
        Logger.log("========================================");
        Logger.log("전체 기사 = "+total);
        Logger.log("최근 진단 성공 = "+successCount);
        Logger.log("최근 진단 실패 = "+failCount);
        Logger.log("진단 없음 = "+noDiagnosticCount);
        Logger.log("========================================");

        result.forEach(function(item){

            Logger.log(
                "기사ID = "+
                item.driver_id+
                " / "+
                item.diagnostic_status
            );

            if(item.diagnostic){

                Logger.log(
                    "  진단시간 = "+
                    String(item.diagnostic.time||"")
                );

                Logger.log(
                    "  성공 = "+
                    String(item.diagnostic.success)
                );

                if(item.diagnostic.data){

                    Logger.log(
                        "  요청 GPS = "+
                        JSON.stringify(
                            item.diagnostic.data
                        )
                    );
                }

                if(
                    Array.isArray(item.diagnostic.result)&&
                    item.diagnostic.result.length>0
                ){

                    Logger.log(
                        "  Supabase 결과 = "+
                        JSON.stringify(
                            item.diagnostic.result[0]
                        )
                    );
                }

                if(item.diagnostic.error){

                    Logger.log(
                        "  오류 = "+
                        item.diagnostic.error
                    );
                }
            }

            Logger.log("----------------------------------------");
        });

        Logger.log("========================================");
        Logger.log("🔎 기사별 GPS 진단 종료");
        Logger.log("========================================");

        return{
            success:true,
            total:total,
            successCount:successCount,
            failCount:failCount,
            noDiagnosticCount:noDiagnosticCount,
            result:result
        };

    }catch(e){

        Logger.log(
            "❌ 전체 GPS 진단 조회 오류 = "+
            e.toString()
        );

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

//==================================================
// 기사 GPS 종합 진단
// Google Sheet vs Supabase
// 기존 GPS_DIAG 캐시까지 함께 확인
//==================================================
function testAllDriversGpsCompleteDiagnostic(){

    Logger.log("========================================");
    Logger.log("🔎 기사 GPS 종합 진단 시작");
    Logger.log("========================================");

    try{

        const sheet=getDriverSheet();

        if(!sheet){
            throw new Error("기사상태_DB 시트를 찾을 수 없습니다.");
        }

        const data=sheet.getDataRange().getValues();

        if(!data||data.length<=1){
            Logger.log("기사 데이터가 없습니다.");
            return;
        }

        //==================================================
        // 1. Supabase 전체 기사 조회
        //==================================================

        const supabaseData=supabaseRequest(
            "drivers?select=driver_id,work_status,latitude,longitude,gps_time",
            "GET"
        );

        const supabaseMap={};

        (supabaseData||[]).forEach(function(row){

            if(!row)return;

            const id=String(row.driver_id||"").trim();

            if(id){
                supabaseMap[id]=row;
            }

        });

        //==================================================
        // 2. 현재 시간
        //==================================================

        const now=new Date();

        Logger.log(
            "현재 시각(KST) = "+
            Utilities.formatDate(
                now,
                "Asia/Seoul",
                "yyyy-MM-dd HH:mm:ss"
            )
        );

        //==================================================
        // 결과 카운트
        //==================================================

        let normalCount=0;
        let gpsStoppedCount=0;
        let syncSuspectCount=0;
        let retiredCount=0;
        let supabaseMissingCount=0;

        //==================================================
        // 3. 기사별 검사
        //==================================================

        for(let i=1;i<data.length;i++){

            const row=data[i];

            if(!row)continue;

            const driverId=
                String(
                    row[DRIVER_COL.ID]||""
                ).trim();

            if(!driverId)continue;

            const name=
                String(
                    row[DRIVER_COL.NAME]||""
                ).trim();

            const workStatus=
                String(
                    row[DRIVER_COL.STATUS]||""
                ).trim();

            const sheetLat=
                Number(row[DRIVER_COL.LAT]);

            const sheetLng=
                Number(row[DRIVER_COL.LNG]);

            const sheetGpsRaw=
                row[DRIVER_COL.GPS_TIME];

            const supa=
                supabaseMap[driverId];

            //================================================
            // Sheet GPS 시간
            //================================================

            let sheetGpsTime=null;

            if(
                sheetGpsRaw instanceof Date &&
                !isNaN(sheetGpsRaw.getTime())
            ){

                sheetGpsTime=
                    new Date(sheetGpsRaw.getTime());

            }else if(sheetGpsRaw){

                const parsed=
                    new Date(sheetGpsRaw);

                if(!isNaN(parsed.getTime())){
                    sheetGpsTime=parsed;
                }

            }

            //================================================
            // Supabase GPS 시간
            //================================================

            let supaGpsTime=null;

            if(
                supa &&
                supa.gps_time
            ){

                const parsed=
                    new Date(supa.gps_time);

                if(!isNaN(parsed.getTime())){
                    supaGpsTime=parsed;
                }

            }

            //================================================
            // GPS 나이 계산
            //================================================

            let sheetAgeSec=null;
            let supaAgeSec=null;
            let diffSec=null;

            if(sheetGpsTime){

                sheetAgeSec=
                    Math.max(
                        0,
                        (now.getTime()-sheetGpsTime.getTime())/1000
                    );

            }

            if(supaGpsTime){

                supaAgeSec=
                    Math.max(
                        0,
                        (now.getTime()-supaGpsTime.getTime())/1000
                    );

            }

            if(sheetGpsTime&&supaGpsTime){

                diffSec=
                    Math.abs(
                        sheetGpsTime.getTime()-
                        supaGpsTime.getTime()
                    )/1000;

            }

            //================================================
            // 기존 GPS 진단 캐시 확인
            //================================================

            let gpsDiagnostic=null;

            try{

                const diagnostic=
                    CacheService
                    .getScriptCache()
                    .get("GPS_DIAG_"+driverId);

                if(diagnostic){

                    try{
                        gpsDiagnostic=
                            JSON.parse(diagnostic);
                    }catch(e){
                        gpsDiagnostic={
                            raw:diagnostic
                        };
                    }

                }

            }catch(e){}

            //================================================
            // 결과 판정
            //================================================

            let result="";

            // ---------------------------------------------
            // Supabase 데이터 없음
            // ---------------------------------------------

            if(!supa){

                supabaseMissingCount++;

                if(
                    workStatus==="근무중" &&
                    sheetAgeSec!==null &&
                    sheetAgeSec<=300
                ){

                    result=
                        "🔴 Supabase 저장 의심";

                }else{

                    result=
                        "🟡 Supabase 데이터 없음 / GPS 오래됨";

                }

            }

            // ---------------------------------------------
            // Sheet GPS 시간이 없음
            // ---------------------------------------------

            else if(!sheetGpsTime){

                if(workStatus==="퇴근함"){

                    retiredCount++;

                    result=
                        "⚪ 퇴근 상태";

                }else{

                    gpsStoppedCount++;

                    result=
                        "🟡 Sheet GPS 시간 없음";

                }

            }

            // ---------------------------------------------
            // 퇴근 기사
            // ---------------------------------------------

            else if(workStatus==="퇴근함"){

                retiredCount++;

                result=
                    "⚪ 퇴근 상태 / 이전 GPS";

            }

            // ---------------------------------------------
            // 근무중인데 Sheet GPS가 오래됨
            // ---------------------------------------------

            else if(
                workStatus==="근무중" &&
                sheetAgeSec>300
            ){

                gpsStoppedCount++;

                result=
                    "🟡 GPS 중단 가능";

            }

            // ---------------------------------------------
            // Sheet GPS와 Supabase GPS 모두 있음
            // ---------------------------------------------

            else if(
                diffSec!==null &&
                diffSec<=30
            ){

                normalCount++;

                result=
                    "🟢 정상";

            }

            // ---------------------------------------------
            // GPS 샘플 차이가 약간 있음
            // ---------------------------------------------

            else if(
                diffSec!==null &&
                diffSec<=120
            ){

                normalCount++;

                result=
                    "🟢 정상 범위 / GPS 샘플 차이";

            }

            // ---------------------------------------------
            // 근무중 + Sheet 최신 + Supabase 오래됨
            // ---------------------------------------------

            else if(
                workStatus==="근무중" &&
                sheetAgeSec<=300 &&
                (
                    supaGpsTime===null ||
                    supaAgeSec>sheetAgeSec+120
                )
            ){

                syncSuspectCount++;

                result=
                    "🔴 Supabase 동기화 의심";

            }

            // ---------------------------------------------
            // 그 외
            // ---------------------------------------------

            else{

                gpsStoppedCount++;

                result=
                    "🟡 확인 필요";

            }

            //================================================
            // 로그 출력
            //================================================

            Logger.log("----------------------------------------");

            Logger.log(
                "기사ID = "+driverId+
                " / 이름 = "+name
            );

            Logger.log(
                "판정 = "+result
            );

            Logger.log(
                "근무상태 = "+workStatus
            );

            Logger.log(
                "Sheet GPS = "+
                (
                    sheetGpsTime
                    ?
                    sheetGpsTime.toISOString()
                    :
                    "없음"
                )
            );

            Logger.log(
                "Sheet GPS 경과 = "+
                (
                    sheetAgeSec!==null
                    ?
                    Math.round(sheetAgeSec)+"초"
                    :
                    "계산불가"
                )
            );

            if(supa){

                Logger.log(
                    "Supabase GPS = "+
                    (
                        supaGpsTime
                        ?
                        supaGpsTime.toISOString()
                        :
                        "없음"
                    )
                );

                Logger.log(
                    "Supabase GPS 경과 = "+
                    (
                        supaAgeSec!==null
                        ?
                        Math.round(supaAgeSec)+"초"
                        :
                        "계산불가"
                    )
                );

                Logger.log(
                    "Sheet ↔ Supabase 시간차 = "+
                    (
                        diffSec!==null
                        ?
                        Math.round(diffSec)+"초"
                        :
                        "계산불가"
                    )
                );

                Logger.log(
                    "Sheet 좌표 = "+
                    sheetLat+
                    ","+
                    sheetLng
                );

                Logger.log(
                    "Supabase 좌표 = "+
                    Number(supa.latitude)+
                    ","+
                    Number(supa.longitude)
                );

            }else{

                Logger.log(
                    "Supabase = ❌ 데이터 없음"
                );

            }

            //================================================
            // 기존 실제 GPS 진단 결과
            //================================================

            if(gpsDiagnostic){

                Logger.log(
                    "기존 GPS 실행진단 = "+
                    JSON.stringify(gpsDiagnostic)
                );

            }else{

                Logger.log(
                    "기존 GPS 실행진단 = 없음"
                );

            }

        }

        //==================================================
        // 최종 결과
        //==================================================

        Logger.log("========================================");
        Logger.log("📊 기사 GPS 종합 진단 결과");
        Logger.log("========================================");

        Logger.log(
            "전체 기사 = "+
            (data.length-1)
        );

        Logger.log(
            "🟢 정상 = "+
            normalCount
        );

        Logger.log(
            "🟡 GPS 중단/확인 필요 = "+
            gpsStoppedCount
        );

        Logger.log(
            "🔴 Supabase 동기화 의심 = "+
            syncSuspectCount
        );

        Logger.log(
            "⚪ 퇴근 상태 = "+
            retiredCount
        );

        Logger.log(
            "❌ Supabase 없음 = "+
            supabaseMissingCount
        );

        Logger.log("========================================");
        Logger.log("🔎 기사 GPS 종합 진단 종료");
        Logger.log("========================================");

    }catch(err){

        Logger.log("❌ 종합 진단 오류");
        Logger.log(err.toString());
        Logger.log(err.stack||"stack 없음");

        throw err;
    }
}

//==================================================
// GPS 실행 추적 기록
// 최근 GPS 실행 10건 저장
// 기존 GPS 동작에는 영향 없음
//==================================================
function saveGpsExecutionTrace(driverId,traceData){

    driverId=String(driverId||"").trim();

    if(!driverId)return false;

    const cacheKey="GPS_TRACE_"+driverId;

    const lock=LockService.getScriptLock();

    try{

        lock.tryLock(3000);

        const cache=
            CacheService.getScriptCache();

        let list=[];

        const oldData=
            cache.get(cacheKey);

        if(oldData){

            try{

                list=
                    JSON.parse(oldData);

                if(!Array.isArray(list)){
                    list=[];
                }

            }catch(e){

                list=[];

            }

        }

        list.push({
            time:new Date().toISOString(),
            driverId:driverId,
            data:traceData||{}
        });

        // 최근 10개 실행만 유지
        if(list.length>10){

            list=
                list.slice(
                    list.length-10
                );

        }

        cache.put(
            cacheKey,
            JSON.stringify(list),
            21600
        );

        return true;

    }catch(err){

        Logger.log(
            "GPS TRACE 기록 오류 = "+
            err.toString()
        );

        return false;

    }finally{

        try{
            lock.releaseLock();
        }catch(e){}

    }
}


//==================================================
// 기사 GPS 최근 실행 10건 조회
//==================================================
function getGpsExecutionTrace(driverId){

    driverId=
        String(driverId||"").trim();

    if(!driverId){

        return "기사ID가 없습니다.";

    }

    const cacheKey=
        "GPS_TRACE_"+driverId;

    const data=
        CacheService
        .getScriptCache()
        .get(cacheKey);

    if(!data){

        return (
            "GPS 실행 추적 데이터가 없습니다.\n"+
            "해당 기사 앱에서 GPS를 다시 전송해 주세요."
        );

    }

    try{

        return JSON.stringify(
            JSON.parse(data),
            null,
            2
        );

    }catch(e){

        return data;

    }

}


//==================================================
// k5879512 GPS 최근 10건
//==================================================
function testGpsTraceK5879512(){

    const result=
        getGpsExecutionTrace(
            "k5879512"
        );

    Logger.log(
        "========================================"
    );

    Logger.log(
        "📡 k5879512 GPS 실행 추적"
    );

    Logger.log(result);

    Logger.log(
        "========================================"
    );

    return result;

}

function testGpsTraceOfLower(){
    const result=getGpsExecutionTrace("oflower");
    Logger.log("========================================");
    Logger.log("📡 oflower GPS 실행 추적");
    Logger.log(result);
    Logger.log("========================================");
    return result;
}


//==================================================
// sun6446 GPS 최근 10건
//==================================================
function testGpsTraceSun6446(){

    const result=
        getGpsExecutionTrace(
            "sun6446"
        );

    Logger.log(
        "========================================"
    );

    Logger.log(
        "📡 sun6446 GPS 실행 추적"
    );

    Logger.log(result);

    Logger.log(
        "========================================"
    );

    return result;

}

// ============================================================
// GPS Supabase 마지막 진단 결과 저장
// ============================================================
function saveGpsSupabaseDiagnostic(data){
    try{
        const props=
            PropertiesService.getScriptProperties();

        props.setProperty(
            "LAST_GPS_SUPABASE_DIAGNOSTIC",
            JSON.stringify(data)
        );

    }catch(e){

        Logger.log(
            "⚠️ GPS 진단정보 저장 실패: "+
            e.toString()
        );
    }
}


// ============================================================
// GPS Supabase 마지막 진단 결과 조회
// ============================================================
function getLastGpsSupabaseDiagnostic(){
    try{
        const props=
            PropertiesService.getScriptProperties();

        const json=
            props.getProperty(
                "LAST_GPS_SUPABASE_DIAGNOSTIC"
            );

        if(!json){
            return{
                success:false,
                message:"저장된 GPS Supabase 진단 정보가 없습니다."
            };
        }

        const data=
            JSON.parse(json);

        Logger.log("========================================");
        Logger.log("🔎 마지막 GPS Supabase 진단 결과");
        Logger.log("========================================");
        Logger.log(JSON.stringify(data));
        Logger.log("========================================");

        return data;

    }catch(e){

        Logger.log(
            "❌ GPS Supabase 진단 조회 실패: "+
            e.toString()
        );

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

// ============================================================
// Supabase 기사 근무상태 이중기록 테스트
// ============================================================
function testDriverWorkStatusSupabase(){
    try{
        const driverId="k5879512";
        const status="근무중";

        Logger.log("===== 기사 근무상태 테스트 =====");
        Logger.log("driverId = "+driverId);
        Logger.log("status = "+status);

        const result=setDriverWorkStatus(
            driverId,
            status
        );

        Logger.log("===== 테스트 결과 =====");
        Logger.log(JSON.stringify(result));

        return result;

    }catch(e){

        Logger.log("❌ 테스트 오류: "+e.toString());

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

// ============================================================
// Supabase 기사 GPS 이중기록 테스트
// ============================================================
function testDriverLocationSupabase(){
    try{
        const driverId="k5879512";

        // 테스트용 좌표
        const lat=35.239972;
        const lng=128.664598;

        Logger.log("===== 기사 GPS 테스트 =====");
        Logger.log("driverId = "+driverId);
        Logger.log("lat = "+lat);
        Logger.log("lng = "+lng);

        const result=updateDriverLocation(
            driverId,
            lat,
            lng
        );

        Logger.log("===== GPS 테스트 결과 =====");
        Logger.log(JSON.stringify(result));

        return result;

    }catch(e){

        Logger.log("❌ GPS 테스트 오류: "+e.toString());

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

function testDriverSheetVsSupabase(){
    try{
        //const driverId="oflower";
        const driverId="k5879512";
        //const driverId="yhkim77777";
        //const driverId="tjwlstjr1";
        //const driverId="장이요";
        //const driverId="sun6446";
        //const driverId="나영기";

        Logger.log("========================================");
        Logger.log("📊 Sheet vs Supabase 기사 데이터 비교");
        Logger.log("기사ID = "+driverId);
        Logger.log("========================================");

        // -----------------------------
        // 1. Sheet
        // -----------------------------
        const driver=findDriverRow(driverId);

        if(!driver){
            throw new Error("Sheet에서 기사를 찾을 수 없습니다: "+driverId);
        }

        const sheet= getDriverSheet();
        const sheetData=sheet.getRange(
            driver.row,
            1,
            1,
            10
        ).getValues()[0];

        const sheetGps={
            driver_id:String(sheetData[DRIVER_COL.ID]||""),
            work_status:String(sheetData[DRIVER_COL.STATUS]||""),
            latitude:sheetData[DRIVER_COL.LAT],
            longitude:sheetData[DRIVER_COL.LNG],
            gps_time:sheetData[DRIVER_COL.GPS_TIME]
        };

        Logger.log("----- Google Sheet -----");
        Logger.log(JSON.stringify(sheetGps));

        // -----------------------------
        // 2. Supabase
        // -----------------------------
        const supabaseResult=supabaseRequest(
            "drivers?select=driver_id,work_status,latitude,longitude,gps_time&driver_id=eq."+encodeURIComponent(driverId),
            "GET"
        );

        if(!Array.isArray(supabaseResult)||supabaseResult.length===0){
            throw new Error("Supabase에서 기사를 찾을 수 없습니다: "+driverId);
        }

        const supabaseGps=supabaseResult[0];

        Logger.log("----- Supabase -----");
        Logger.log(JSON.stringify(supabaseGps));

        // -----------------------------
        // 3. 비교
        // -----------------------------
        const latEqual=
            Number(sheetGps.latitude)===Number(supabaseGps.latitude);

        const lngEqual=
            Number(sheetGps.longitude)===Number(supabaseGps.longitude);

        const statusEqual=
            sheetGps.work_status===String(supabaseGps.work_status||"");

        Logger.log("========================================");
        Logger.log("🔎 비교 결과");
        Logger.log("근무상태 일치 = "+statusEqual);
        Logger.log("위도 일치 = "+latEqual);
        Logger.log("경도 일치 = "+lngEqual);
        Logger.log("========================================");

        if(statusEqual&&latEqual&&lngEqual){
            Logger.log("✅ Sheet와 Supabase 데이터가 일치합니다.");
        }else{
            Logger.log("⚠️ Sheet와 Supabase 데이터가 다릅니다.");
        }

        return{
            success:true,
            driverId:driverId,
            sheet:sheetGps,
            supabase:supabaseGps,
            compare:{
                work_status:statusEqual,
                latitude:latEqual,
                longitude:lngEqual
            }
        };

    }catch(e){

        Logger.log("❌ 비교 테스트 오류");
        Logger.log(e.toString());

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

function testSupabaseDriverGpsPatch(){
    try{
        const driverId="k5879512";
        const lat=35.239972;
        const lng=128.664598;
        const gpsTime=new Date().toISOString();

        const path=
            "drivers?driver_id=eq."+
            encodeURIComponent(driverId)+
            "&select=driver_id,work_status,latitude,longitude,gps_time";

        const data={
            latitude:lat,
            longitude:lng,
            gps_time:gpsTime
        };

        Logger.log("===== SUPABASE GPS 직접 PATCH 테스트 =====");
        Logger.log("driverId = "+driverId);
        Logger.log("data = "+JSON.stringify(data));
        Logger.log("path = "+path);

        const result=supabaseRequest(
            path,
            "PATCH",
            data
        );

        Logger.log("===== PATCH 최종 결과 =====");
        Logger.log("result = "+JSON.stringify(result));

        if(!Array.isArray(result)||result.length===0){
            Logger.log("❌ 수정된 기사가 없습니다.");
            return{
                success:false,
                message:"Supabase에서 수정된 행이 없습니다.",
                data:result
            };
        }

        Logger.log("✅ Supabase GPS PATCH 성공");
        Logger.log(JSON.stringify(result[0]));

        return{
            success:true,
            message:"Supabase GPS PATCH 성공",
            data:result[0]
        };

    }catch(e){
        Logger.log("❌ Supabase GPS PATCH 테스트 실패");
        Logger.log(e.toString());

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

function testAllDriversSheetVsSupabase(){
    try{
        Logger.log("========================================");
        Logger.log("📊 전체 기사 Sheet vs Supabase 비교");
        Logger.log("========================================");

        const sheet=getDriverSheet();

        if(!sheet){
            Logger.log("❌ 기사상태_DB를 찾을 수 없습니다.");
            return;
        }

        const data=sheet.getDataRange().getValues();

        if(!data||data.length<=1){
            Logger.log("❌ 기사 데이터가 없습니다.");
            return;
        }

        let path="drivers?select=driver_id,work_status,latitude,longitude,gps_time";
        const supabaseData=supabaseRequest(path,"GET");

        if(!Array.isArray(supabaseData)){
            Logger.log("❌ Supabase 기사 데이터가 배열이 아닙니다.");
            return;
        }

        const supabaseMap={};

        supabaseData.forEach(function(row){
            if(!row||!row.driver_id)return;
            supabaseMap[String(row.driver_id).trim()]=row;
        });

        let total=0;
        let match=0;
        let mismatch=0;
        let missing=0;

        const result=[];

        for(let i=1;i<data.length;i++){

            const row=data[i];

            if(!row)continue;

            const driverId=
                String(row[DRIVER_COL.ID]||"").trim();

            if(!driverId)continue;

            total++;

            const sheetData={
                driver_id:driverId,
                work_status:String(row[DRIVER_COL.STATUS]||"").trim(),
                latitude:Number(row[DRIVER_COL.LAT]),
                longitude:Number(row[DRIVER_COL.LNG]),
                gps_time:row[DRIVER_COL.GPS_TIME]
                    instanceof Date
                    ?row[DRIVER_COL.GPS_TIME].toISOString()
                    :String(row[DRIVER_COL.GPS_TIME]||"")
            };

            const supa=supabaseMap[driverId];

            if(!supa){

                missing++;

                result.push({
                    driver_id:driverId,
                    status:"❌ Supabase 없음",
                    sheet:sheetData,
                    supabase:null
                });

                continue;
            }

            const statusMatch=
                sheetData.work_status===
                String(supa.work_status||"").trim();

            const latMatch=
                Number(sheetData.latitude)===
                Number(supa.latitude);

            const lngMatch=
                Number(sheetData.longitude)===
                Number(supa.longitude);

            const sheetTime=
                new Date(sheetData.gps_time).getTime();

            const supabaseTime=
                new Date(supa.gps_time).getTime();

            const timeDiff=
                isNaN(sheetTime)||isNaN(supabaseTime)
                ?null
                :Math.abs(sheetTime-supabaseTime);

            const timeMatch=
                timeDiff!==null &&
                timeDiff<1000;

            const allMatch=
                statusMatch&&
                latMatch&&
                lngMatch&&
                timeMatch;

            if(allMatch){
                match++;
            }else{
                mismatch++;
            }

            result.push({
                driver_id:driverId,
                status:allMatch
                    ?"✅ 일치"
                    :"⚠️ 불일치",
                work_status_match:statusMatch,
                latitude_match:latMatch,
                longitude_match:lngMatch,
                gps_time_match:timeMatch,
                gps_time_difference_ms:timeDiff,
                sheet:sheetData,
                supabase:{
                    driver_id:String(supa.driver_id||""),
                    work_status:String(supa.work_status||"").trim(),
                    latitude:Number(supa.latitude),
                    longitude:Number(supa.longitude),
                    gps_time:String(supa.gps_time||"")
                }
            });
        }

        Logger.log("========================================");
        Logger.log("📊 전체 기사 비교 결과");
        Logger.log("========================================");
        Logger.log("전체 기사 = "+total);
        Logger.log("완전 일치 = "+match);
        Logger.log("불일치 = "+mismatch);
        Logger.log("Supabase 없음 = "+missing);
        Logger.log("========================================");

        result.forEach(function(item){

            Logger.log(
                "기사ID = "+item.driver_id+
                " / "+item.status
            );

            if(item.status!=="❌ Supabase 없음"){

                Logger.log(
                    "  근무상태 = "+
                    item.work_status_match
                );

                Logger.log(
                    "  위도 = "+
                    item.latitude_match
                );

                Logger.log(
                    "  경도 = "+
                    item.longitude_match
                );

                Logger.log(
                    "  GPS시간 = "+
                    item.gps_time_match+
                    " / 차이(ms) = "+
                    item.gps_time_difference_ms
                );

                if(item.status!=="✅ 일치"){

                    Logger.log(
                        "  Sheet = "+
                        JSON.stringify(item.sheet)
                    );

                    Logger.log(
                        "  Supabase = "+
                        JSON.stringify(item.supabase)
                    );
                }
            }
        });

        Logger.log("========================================");
        Logger.log("🔎 전체 기사 비교 종료");
        Logger.log("========================================");

        return{
            success:true,
            total:total,
            match:match,
            mismatch:mismatch,
            missing:missing,
            result:result
        };

    }catch(e){

        Logger.log(
            "❌ 전체 기사 비교 오류 = "+
            e.toString()
        );

        return{
            success:false,
            message:e.message||String(e)
        };
    }
}

//==================================================
// GPS Supabase 직접 동기화 검증
// 테스트 대상:
// yhkim77777 / 나영기 / k5879512
// Google Sheet 현재 GPS → Supabase → 즉시 재조회
//==================================================
function testThreeDriversGpsDirectSync(){

    const testDrivers=[
    "yhkim77777",
    "나영기",
    "k5879512",
    "oflower"
];

    Logger.log("==================================================");
    Logger.log("🧪 3명 GPS 직접 동기화 검증 시작");
    Logger.log("==================================================");

    const sheet=getDriverSheet();

    if(!sheet){
        Logger.log("❌ 기사상태_DB를 찾을 수 없습니다.");
        return false;
    }

    const data=sheet.getDataRange().getValues();

    testDrivers.forEach(function(driverId){

        Logger.log("----------------------------------------");
        Logger.log("🎯 테스트 기사 = "+driverId);

        let rowData=null;

        for(let i=1;i<data.length;i++){

            const row=data[i];

            if(!row)continue;

            const id=
                String(row[DRIVER_COL.ID]||"").trim();

            if(id===driverId){

                rowData=row;
                break;
            }
        }

        if(!rowData){

            Logger.log(
                "❌ Sheet에서 기사를 찾지 못함 = "+
                driverId
            );

            return;
        }

        const latitude=
            Number(rowData[DRIVER_COL.LAT]);

        const longitude=
            Number(rowData[DRIVER_COL.LNG]);

        const gpsTimeValue=
            rowData[DRIVER_COL.GPS_TIME];

        let gpsTime="";

        if(gpsTimeValue instanceof Date){

            gpsTime=
                gpsTimeValue.toISOString();

        }else{

            gpsTime=
                String(gpsTimeValue||"").trim();

        }

        const workStatus=
            String(rowData[DRIVER_COL.STATUS]||"").trim();

        Logger.log(
            "Sheet 상태 = "+
            workStatus
        );

        Logger.log(
            "Sheet GPS = "+
            latitude+
            ","+
            longitude
        );

        Logger.log(
            "Sheet GPS TIME = "+
            gpsTime
        );

        if(
            !isFinite(latitude)||
            !isFinite(longitude)||
            !gpsTime
        ){

            Logger.log(
                "❌ GPS 데이터가 올바르지 않음"
            );

            return;
        }

        //==================================================
        // 1. 현재 Sheet GPS를 Supabase에 직접 PATCH
        //==================================================

        const updateData={
            latitude:latitude,
            longitude:longitude,
            gps_time:gpsTime
        };

        Logger.log(
            "📤 Supabase 직접 PATCH = "+
            JSON.stringify(updateData)
        );

        const syncResult=
            syncDriverToSupabase(
                driverId,
                updateData
            );

        Logger.log(
            "📥 syncDriverToSupabase 반환 = "+
            JSON.stringify(syncResult)
        );

        //==================================================
        // 2. Supabase 현재값 즉시 조회
        //==================================================

        const checkPath=
            "drivers?driver_id=eq."+
            encodeURIComponent(driverId)+
            "&select=driver_id,work_status,latitude,longitude,gps_time";

        const checkResult=
            supabaseRequest(
                checkPath,
                "GET"
            );

        Logger.log(
            "🔎 PATCH 직후 Supabase 조회 = "+
            JSON.stringify(checkResult)
        );

        if(
            Array.isArray(checkResult)&&
            checkResult.length>0
        ){

            const current=
                checkResult[0];

            const sameLat=
                Number(current.latitude)===latitude;

            const sameLng=
                Number(current.longitude)===longitude;

            const sameTime=
                String(current.gps_time||"")===gpsTime||
                new Date(current.gps_time).getTime()===
                new Date(gpsTime).getTime();

            Logger.log(
                "좌표 비교 = "+
                JSON.stringify({
                    latitude:sameLat,
                    longitude:sameLng,
                    gpsTime:sameTime
                })
            );

            if(
                sameLat&&
                sameLng&&
                sameTime
            ){

                Logger.log(
                    "🟢 직접 동기화 성공 = "+
                    driverId
                );

            }else{

                Logger.log(
                    "🔴 직접 동기화 후에도 값 불일치 = "+
                    driverId
                );

            }

        }else{

            Logger.log(
                "🔴 Supabase에서 기사를 다시 찾지 못함 = "+
                driverId
            );
        }

    });

    Logger.log("==================================================");
    Logger.log("🧪 3명 GPS 직접 동기화 검증 종료");
    Logger.log("==================================================");

    return true;
}

//==================================================
// 4명 GPS 실시간 Sheet ↔ Supabase 비교 진단
// 대상:
// yhkim77777 / 나영기 / k5879512 / oflower
// 기존 GPS / 동기화 코드 수정 없음
//==================================================
function testFourDriversGpsLiveCompare(){

    const testDrivers=[
        "yhkim77777",
        "나영기",
        "k5879512",
        "oflower"
    ];

    Logger.log("==================================================");
    Logger.log("📡 4명 GPS 실시간 비교 진단 시작");
    Logger.log("==================================================");

    const sheet=getDriverSheet();

    if(!sheet){
        Logger.log("❌ 기사상태_DB를 찾을 수 없습니다.");
        return false;
    }

    const sheetData=sheet.getDataRange().getValues();

    testDrivers.forEach(function(driverId){

        Logger.log("----------------------------------------");
        Logger.log("🎯 "+driverId);

        let rowData=null;

        for(let i=1;i<sheetData.length;i++){

            const row=sheetData[i];

            if(!row)continue;

            const id=
                String(row[DRIVER_COL.ID]||"").trim();

            if(id===driverId){
                rowData=row;
                break;
            }
        }

        if(!rowData){
            Logger.log("❌ Sheet 기사 없음");
            return;
        }

        const workStatus=
            String(rowData[DRIVER_COL.STATUS]||"").trim();

        const sheetLat=
            Number(rowData[DRIVER_COL.LAT]);

        const sheetLng=
            Number(rowData[DRIVER_COL.LNG]);

        const sheetGpsValue=
            rowData[DRIVER_COL.GPS_TIME];

        let sheetGpsTime="";

        if(sheetGpsValue instanceof Date){
            sheetGpsTime=sheetGpsValue.toISOString();
        }else{
            sheetGpsTime=
                String(sheetGpsValue||"").trim();
        }

        Logger.log(
            "Sheet = "+
            JSON.stringify({
                status:workStatus,
                latitude:sheetLat,
                longitude:sheetLng,
                gps_time:sheetGpsTime
            })
        );

        const path=
            "drivers?driver_id=eq."+
            encodeURIComponent(driverId)+
            "&select=driver_id,work_status,latitude,longitude,gps_time";

        let supabaseResult=null;

        try{

            supabaseResult=
                supabaseRequest(
                    path,
                    "GET"
                );

        }catch(e){

            Logger.log(
                "🔴 Supabase 조회 오류 = "+
                e.toString()
            );

            return;
        }

        if(
            !Array.isArray(supabaseResult)||
            supabaseResult.length===0
        ){

            Logger.log("🔴 Supabase 기사 없음");
            return;
        }

        const sb=supabaseResult[0];

        const sbLat=Number(sb.latitude);
        const sbLng=Number(sb.longitude);

        const sbGpsTime=
            String(sb.gps_time||"").trim();

        let timeDiffSec=null;

        if(sheetGpsTime&&sbGpsTime){

            const sheetTime=
                new Date(sheetGpsTime).getTime();

            const sbTime=
                new Date(sbGpsTime).getTime();

            if(
                isFinite(sheetTime)&&
                isFinite(sbTime)
            ){
                timeDiffSec=
                    Math.round(
                        Math.abs(sheetTime-sbTime)/1000
                    );
            }
        }

        const latDiff=
            isFinite(sheetLat)&&
            isFinite(sbLat)
                ? Math.abs(sheetLat-sbLat)
                : null;

        const lngDiff=
            isFinite(sheetLng)&&
            isFinite(sbLng)
                ? Math.abs(sheetLng-sbLng)
                : null;

        let result="";

        if(
            workStatus==="퇴근함"
        ){
            result="⚪ 퇴근 기사";

        }else if(
            timeDiffSec===null
        ){
            result="🟡 시간 비교 불가";

        }else if(
            timeDiffSec<=15 &&
            latDiff!==null &&
            lngDiff!==null &&
            latDiff<0.001 &&
            lngDiff<0.001
        ){
            result="🟢 정상";

        }else if(
            timeDiffSec<=120
        ){
            result="🟡 약간의 차이";

        }else{
            result="🔴 동기화 지연 의심";
        }

        Logger.log(
            "Supabase = "+
            JSON.stringify({
                status:sb.work_status,
                latitude:sbLat,
                longitude:sbLng,
                gps_time:sbGpsTime
            })
        );

        Logger.log(
            "차이 = "+
            JSON.stringify({
                timeDiffSec:timeDiffSec,
                latitudeDiff:latDiff,
                longitudeDiff:lngDiff
            })
        );

        Logger.log(
            "판정 = "+result
        );
    });

    Logger.log("==================================================");
    Logger.log("📡 4명 GPS 실시간 비교 진단 종료");
    Logger.log("==================================================");

    return true;
}

function diagnoseOFlowerServerConnection(){
    const result={
        test:"OFLOWER_SERVER_CONNECTION",
        time:new Date().toISOString(),
        updateDriverLocationType:typeof updateDriverLocation,
        syncDriverToSupabaseType:typeof syncDriverToSupabase,
        saveGpsExecutionTraceType:typeof saveGpsExecutionTrace,
        getGpsExecutionTraceType:typeof getGpsExecutionTrace,
        driverId:"oflower"
    };

    try{
        const driver=findDriverRow("oflower");

        result.driverFound=!!driver;

        if(driver){
            result.driverRow=driver.row;
        }
    }catch(e){
        result.driverFindError=e.toString();
    }

    try{
        const sheet=getDriverSheet();

        result.sheetFound=!!sheet;

        if(sheet){
            result.sheetName=sheet.getName();
        }
    }catch(e){
        result.sheetError=e.toString();
    }

    Logger.log("==================================================");
    Logger.log("🔎 OFLOWER SERVER CONNECTION TEST");
    Logger.log(JSON.stringify(result,null,2));
    Logger.log("==================================================");

    return JSON.stringify(result,null,2);
}

function testOFlowerRealGpsSync(){
    const driverId="oflower";

    Logger.log("==================================================");
    Logger.log("🧪 OFLOWER 실제 GPS 동기화 테스트 시작");
    Logger.log("==================================================");

    try{
        const driver=findDriverRow(driverId);

        if(!driver){
            Logger.log("❌ oflower 기사를 찾을 수 없습니다.");
            return false;
        }

        const sheet=getDriverSheet();

        const lat=Number(
            sheet.getRange(driver.row,DRIVER_COL.LAT+1).getValue()
        );

        const lng=Number(
            sheet.getRange(driver.row,DRIVER_COL.LNG+1).getValue()
        );

        Logger.log("현재 Sheet GPS = "+lat+","+lng);

        if(!isFinite(lat)||!isFinite(lng)){
            Logger.log("❌ 현재 GPS 좌표가 올바르지 않습니다.");
            return false;
        }

        Logger.log("➡️ updateDriverLocation 직접 호출");

        const result=
            updateDriverLocation(
                driverId,
                lat,
                lng
            );

        Logger.log("updateDriverLocation 반환값 = "+result);

        Logger.log("==================================================");
        Logger.log("🧪 OFLOWER 실제 GPS 동기화 테스트 종료");
        Logger.log("==================================================");

        return result;

    }catch(e){
        Logger.log("❌ 테스트 오류 = "+e.toString());
        Logger.log("stack = "+(e.stack||""));
        return false;
    }
}

//==================================================
// Supabase 오더 1건 테스트 마이그레이션
//==================================================
function testSupabaseOrderMigration(){

    const TEST_ORDER_ID="OD260914-HYE6UR";

    try{

        const data=getOrderData();

        if(!data||data.length<=1){
            throw new Error("오더 데이터가 없습니다.");
        }

        let sourceRow=null;

        for(let i=1;i<data.length;i++){

            if(!data[i])continue;

            const orderId=
                String(data[i][ORDER_COL.ORDER_ID]||"").trim();

            if(orderId===TEST_ORDER_ID){
                sourceRow=data[i];
                break;
            }
        }

        if(!sourceRow){
            throw new Error(
                "테스트 오더를 찾을 수 없습니다: "+
                TEST_ORDER_ID
            );
        }

        // ------------------------------------------
        // 날짜 → ISO UTC 변환
        // ------------------------------------------
        function toIsoUtc(value){

            if(value===null||value===undefined||value===""){
                return null;
            }

            if(value instanceof Date){

                if(isNaN(value.getTime())){
                    return null;
                }

                return value.toISOString();
            }

            const parsed=new Date(String(value));

            if(isNaN(parsed.getTime())){
                throw new Error(
                    "날짜 변환 실패: "+
                    String(value)
                );
            }

            return parsed.toISOString();
        }

        // ------------------------------------------
        // Sheet → Supabase 매핑
        // ------------------------------------------
        const payload={

            order_id:
                String(
                    sourceRow[ORDER_COL.ORDER_ID]||""
                ),

            register:
                String(
                    sourceRow[ORDER_COL.REGISTER]||""
                ),

            created_at:
                toIsoUtc(
                    sourceRow[ORDER_COL.DATE]
                ),

            product:
                String(
                    sourceRow[ORDER_COL.PRODUCT]||""
                ),

            route:
                String(
                    sourceRow[ORDER_COL.ROUTE]||""
                ),

            assign_type:
                String(
                    sourceRow[ORDER_COL.ASSIGN_TYPE]||""
                ),

            driver_id:
                String(
                    sourceRow[ORDER_COL.DRIVER_ID]||""
                ),

            status:
                String(
                    sourceRow[ORDER_COL.STATUS]||"미확인"
                ),

            image_url:
                String(
                    sourceRow[ORDER_COL.IMAGE]||""
                ),

            thumb_url:
                String(
                    sourceRow[ORDER_COL.THUMB]||""
                ),

            route_status:
                String(
                    sourceRow[ORDER_COL.ROUTE_STATUS]||""
                ),

            reject_driver:
                String(
                    sourceRow[ORDER_COL.REJECT_DRIVER]||""
                ),

            reject_time:
                toIsoUtc(
                    sourceRow[ORDER_COL.REJECT_TIME]
                ),

            completed_time:
                toIsoUtc(
                    sourceRow[ORDER_COL.COMPLETED_TIME]
                )
        };

        Logger.log(
            "=========================================="
        );

        Logger.log(
            "📦 SUPABASE 오더 1건 테스트 시작"
        );

        Logger.log(
            "오더ID = "+
            TEST_ORDER_ID
        );

        Logger.log(
            "Sheet 원본 = "+
            JSON.stringify(sourceRow)
        );

        Logger.log(
            "Supabase 전송 데이터 = "+
            JSON.stringify(payload)
        );

        // ------------------------------------------
        // 이미 존재하는지 확인
        // ------------------------------------------
        const checkPath=
            "orders?order_id=eq."+
            encodeURIComponent(TEST_ORDER_ID)+
            "&select=order_id";

        const existing=
            supabaseRequest(
                checkPath,
                "GET"
            );

        if(
            Array.isArray(existing)&&
            existing.length>0
        ){

            Logger.log(
                "⚠️ 이미 Supabase에 존재합니다."
            );

            Logger.log(
                JSON.stringify(existing)
            );

            return JSON.stringify({
                success:false,
                alreadyExists:true,
                orderId:TEST_ORDER_ID,
                message:
                    "해당 오더가 이미 Supabase에 존재합니다."
            });
        }

        // ------------------------------------------
        // INSERT
        // ------------------------------------------
        const result=
            supabaseRequest(
                "orders",
                "POST",
                payload
            );

        Logger.log(
            "=========================================="
        );

        Logger.log(
            "✅ Supabase 오더 INSERT 성공"
        );

        Logger.log(
            JSON.stringify(result)
        );

        Logger.log(
            "=========================================="
        );

        return JSON.stringify({
            success:true,
            orderId:TEST_ORDER_ID,
            payload:payload,
            result:result
        });

    }catch(e){

        Logger.log(
            "=========================================="
        );

        Logger.log(
            "❌ Supabase 오더 테스트 실패"
        );

        Logger.log(
            e.toString()
        );

        Logger.log(
            e.stack||"stack 없음"
        );

        Logger.log(
            "=========================================="
        );

        return JSON.stringify({
            success:false,
            error:e.toString()
        });
    }
}

function migrateAllOrdersToSupabase(){

    try{

        const data=getOrderData();

        if(!data||data.length<=1){
            return JSON.stringify({
                success:false,
                message:"이관할 오더가 없습니다."
            });
        }

        function toIsoUtc(value){

            if(value===null||value===undefined||value===""){
                return null;
            }

            if(value instanceof Date){

                if(isNaN(value.getTime())){
                    return null;
                }

                return value.toISOString();
            }

            const parsed=new Date(String(value));

            if(isNaN(parsed.getTime())){
                throw new Error(
                    "날짜 변환 실패: "+
                    String(value)
                );
            }

            return parsed.toISOString();
        }

        let total=0;
        let inserted=0;
        let skipped=0;
        let failed=0;

        const failedOrders=[];

        Logger.log(
            "=========================================="
        );

        Logger.log(
            "📦 전체 오더 Supabase 이관 시작"
        );

        Logger.log(
            "Sheet 전체 행 = "+
            (data.length-1)
        );

        for(let i=1;i<data.length;i++){

            const row=data[i];

            if(!row){
                continue;
            }

            const orderId=
                String(
                    row[ORDER_COL.ORDER_ID]||""
                ).trim();

            if(!orderId){
                Logger.log(
                    "⚠️ 오더ID 없음 → 행 "+(i+1)+" 건너뜀"
                );
                skipped++;
                continue;
            }

            total++;

            try{

                // --------------------------------------
                // Supabase 중복 확인
                // --------------------------------------
                const checkPath=
                    "orders?order_id=eq."+
                    encodeURIComponent(orderId)+
                    "&select=order_id";

                const existing=
                    supabaseRequest(
                        checkPath,
                        "GET"
                    );

                if(
                    Array.isArray(existing)&&
                    existing.length>0
                ){

                    Logger.log(
                        "🟡 이미 존재 → "+
                        orderId
                    );

                    skipped++;
                    continue;
                }

                // --------------------------------------
                // Sheet → Supabase
                // --------------------------------------
                const payload={

                    order_id:
                        String(
                            row[ORDER_COL.ORDER_ID]||""
                        ),

                    register:
                        String(
                            row[ORDER_COL.REGISTER]||""
                        ),

                    created_at:
                        toIsoUtc(
                            row[ORDER_COL.DATE]
                        ),

                    product:
                        String(
                            row[ORDER_COL.PRODUCT]||""
                        ),

                    route:
                        String(
                            row[ORDER_COL.ROUTE]||""
                        ),

                    assign_type:
                        String(
                            row[ORDER_COL.ASSIGN_TYPE]||""
                        ),

                    driver_id:
                        String(
                            row[ORDER_COL.DRIVER_ID]||""
                        ),

                    status:
                        String(
                            row[ORDER_COL.STATUS]||"미확인"
                        ),

                    image_url:
                        String(
                            row[ORDER_COL.IMAGE]||""
                        ),

                    thumb_url:
                        String(
                            row[ORDER_COL.THUMB]||""
                        ),

                    route_status:
                        String(
                            row[ORDER_COL.ROUTE_STATUS]||""
                        ),

                    reject_driver:
                        String(
                            row[ORDER_COL.REJECT_DRIVER]||""
                        ),

                    reject_time:
                        toIsoUtc(
                            row[ORDER_COL.REJECT_TIME]
                        ),

                    completed_time:
                        toIsoUtc(
                            row[ORDER_COL.COMPLETED_TIME]
                        )
                };

                const result=
                    supabaseRequest(
                        "orders",
                        "POST",
                        payload
                    );

                inserted++;

                Logger.log(
                    "✅ 이관 성공 ["+
                    inserted+
                    "] "+
                    orderId
                );

            }catch(orderErr){

                failed++;

                failedOrders.push({
                    row:i+1,
                    orderId:orderId,
                    error:orderErr.toString()
                });

                Logger.log(
                    "❌ 이관 실패 "+
                    orderId+
                    " / "+
                    orderErr.toString()
                );
            }
        }

        Logger.log(
            "=========================================="
        );

        Logger.log(
            "📦 전체 오더 Supabase 이관 완료"
        );

        Logger.log(
            "전체 처리 = "+
            total
        );

        Logger.log(
            "신규 등록 = "+
            inserted
        );

        Logger.log(
            "이미 존재 = "+
            skipped
        );

        Logger.log(
            "실패 = "+
            failed
        );

        if(failedOrders.length>0){

            Logger.log(
                "❌ 실패 목록 = "+
                JSON.stringify(
                    failedOrders,
                    null,
                    2
                )
            );
        }

        Logger.log(
            "=========================================="
        );

        return JSON.stringify({
            success:true,
            total:total,
            inserted:inserted,
            skipped:skipped,
            failed:failed,
            failedOrders:failedOrders
        });

    }catch(e){

        Logger.log(
            "=========================================="
        );

        Logger.log(
            "❌ 전체 오더 이관 치명적 오류"
        );

        Logger.log(
            e.toString()
        );

        Logger.log(
            e.stack||"stack 없음"
        );

        Logger.log(
            "=========================================="
        );

        return JSON.stringify({
            success:false,
            error:e.toString()
        });
    }
}

//==================================================
// 오더 상태 변경 → Supabase 동기화
//==================================================
//==================================================
// Supabase 오더 부분 수정
//==================================================
function updateOrderToSupabase(orderId,updateData){
    try{
        orderId=String(orderId||"").trim();
        if(!orderId)throw new Error("order_id가 없습니다.");
        if(!updateData||typeof updateData!=="object")throw new Error("updateData가 없습니다.");

        const data=Object.assign({},updateData);

        Object.keys(data).forEach(function(key){
            if(data[key]===undefined)delete data[key];
        });

        function convertDate(value){
            if(value===null||value===undefined||value==="")return null;
            if(value instanceof Date)return isNaN(value.getTime())?null:value.toISOString();

            const text=String(value).trim();
            if(!text)return null;

            if(/^\d{10,13}$/.test(text)){
                const n=Number(text);
                const d=new Date(text.length===10?n*1000:n);
                return isNaN(d.getTime())?null:d.toISOString();
            }

            const d=new Date(text);
            if(isNaN(d.getTime()))throw new Error("날짜 변환 실패: "+text);
            return d.toISOString();
        }

        if(Object.prototype.hasOwnProperty.call(data,"reject_time"))data.reject_time=convertDate(data.reject_time);
        if(Object.prototype.hasOwnProperty.call(data,"completed_time"))data.completed_time=convertDate(data.completed_time);

        const path="orders?order_id=eq."+encodeURIComponent(orderId);
        const result=supabaseRequest(path,"PATCH",data);

        Logger.log("🔄 Supabase 부분 수정 완료 = "+orderId);
        Logger.log("수정 데이터 = "+JSON.stringify(data));

        return{
            success:true,
            orderId:orderId,
            result:result
        };

    }catch(e){
        Logger.log("❌ Supabase 부분 수정 실패 = "+orderId+" / "+e.toString());
        return{
            success:false,
            orderId:orderId,
            error:e.toString()
        };
    }
}

//==================================================
// DriverApp 전용 Supabase 오더 조회
// 현재 운영: 해당 기사에게 배정된 오더만 조회
//==================================================
function getOrdersDataForDriver(driverId){
    try{
        driverId=String(driverId||"").trim();
        if(!driverId)return JSON.stringify([]);

        const select="order_id,register,created_at,product,route,assign_type,driver_id,status,image_url,thumb_url,route_status,reject_driver,reject_time,completed_time";
        const path="orders?driver_id=eq."+encodeURIComponent(driverId)+"&select="+select+"&order=created_at.desc";
        const data=supabaseRequest(path,"GET")||[];

        const result=[];
        if(!Array.isArray(data))return JSON.stringify([]);

        let correctedMap={};
        try{
            const correctedJSON=PropertiesService.getScriptProperties().getProperty("ORDER_CORRECTED_MAP");
            if(correctedJSON)correctedMap=JSON.parse(correctedJSON)||{};
        }catch(e){}

        data.forEach(function(row){
            if(!row||!row.order_id)return;

            const sheetRow=[];
            sheetRow[ORDER_COL.ORDER_ID]=String(row.order_id||"").trim();
            sheetRow[ORDER_COL.REGISTER]=String(row.register||"").trim();

            if(row.created_at){
                const d=new Date(row.created_at);
                sheetRow[ORDER_COL.DATE]=isNaN(d.getTime())?String(row.created_at):Utilities.formatDate(d,"Asia/Seoul","yyyy-MM-dd HH:mm");
            }else{
                sheetRow[ORDER_COL.DATE]="시간정보없음";
            }

            sheetRow[ORDER_COL.PRODUCT]=String(row.product||"").trim();
            sheetRow[ORDER_COL.ROUTE]=String(row.route||"").trim();
            sheetRow[ORDER_COL.ASSIGN_TYPE]=String(row.assign_type||"").trim();
            sheetRow[ORDER_COL.DRIVER_ID]=String(row.driver_id||"").trim();
            sheetRow[ORDER_COL.STATUS]=row.status!==undefined&&row.status!==null?String(row.status).trim():"미확인";
            sheetRow[ORDER_COL.IMAGE]=String(row.image_url||"").trim();
            sheetRow[ORDER_COL.THUMB]=String(row.thumb_url||"").trim();
            sheetRow[ORDER_COL.ROUTE_STATUS]=String(row.route_status||"").trim();
            sheetRow[ORDER_COL.REJECT_DRIVER]=String(row.reject_driver||"").trim();
            sheetRow[ORDER_COL.REJECT_TIME]=row.reject_time||"";
            sheetRow[ORDER_COL.COMPLETED_TIME]=row.completed_time||"";

            sheetRow.push(correctedMap[sheetRow[ORDER_COL.ORDER_ID]]===true);
            result.push(sheetRow);
        });

        Logger.log("🚚 DriverApp Supabase 오더 조회 완료: "+driverId+" / "+result.length+"건");
        return JSON.stringify(result);
    }catch(e){
        Logger.log("❌ DriverApp Supabase 오더 조회 실패: "+e.toString());
        return JSON.stringify([]);
    }
}


//==================================================
// Supabase 오더 1건 저장 엔진
// 신규 = INSERT / 기존 = UPDATE
// Google Sheet 전체를 다시 읽지 않음
//==================================================
function syncOrderToSupabase(orderData){
    try{
        if(!orderData||typeof orderData!=="object")throw new Error("orderData가 없습니다.");
        const orderId=String(orderData.order_id||"").trim();
        if(!orderId)throw new Error("order_id가 없습니다.");

        function toIsoUtc(value){
            if(value===null||value===undefined||value==="")return null;
            if(value instanceof Date)return isNaN(value.getTime())?null:value.toISOString();
            const text=String(value).trim();
            if(!text)return null;
            if(/^\d{10,13}$/.test(text)){
                const n=Number(text);
                const d=new Date(text.length===10?n*1000:n);
                return isNaN(d.getTime())?null:d.toISOString();
            }
            const d=new Date(text);
            if(isNaN(d.getTime()))throw new Error("날짜 변환 실패: "+text);
            return d.toISOString();
        }

        const payload={
            register:String(orderData.register||""),
            created_at:toIsoUtc(orderData.created_at),
            product:String(orderData.product||""),
            route:String(orderData.route||""),
            assign_type:String(orderData.assign_type||"지정배차"),
            driver_id:String(orderData.driver_id||""),
            status:String(orderData.status||"미확인"),
            image_url:String(orderData.image_url||""),
            thumb_url:String(orderData.thumb_url||""),
            route_status:String(orderData.route_status||""),
            reject_driver:String(orderData.reject_driver||""),
            reject_time:toIsoUtc(orderData.reject_time),
            completed_time:toIsoUtc(orderData.completed_time)
        };

        const checkPath="orders?order_id=eq."+encodeURIComponent(orderId)+"&select=order_id";
        const existing=supabaseRequest(checkPath,"GET");

        if(Array.isArray(existing)&&existing.length>0){
            supabaseRequest("orders?order_id=eq."+encodeURIComponent(orderId),"PATCH",payload);
            Logger.log("🔄 Supabase 오더 UPDATE 성공 = "+orderId);
            return true;
        }

        payload.order_id=orderId;
        supabaseRequest("orders","POST",payload);
        Logger.log("✅ Supabase 오더 INSERT 성공 = "+orderId);
        return true;

    }catch(e){
        Logger.log("❌ Supabase 오더 저장 실패 = "+e.toString());
        Logger.log(e.stack||"");
        return false;
    }
}

//==================================================
// Supabase 오더 삭제
//==================================================
function deleteOrderFromSupabase(orderId){
    try{
        orderId=String(orderId||"").trim();
        if(!orderId)throw new Error("order_id가 없습니다.");

        const result=supabaseRequest("orders?order_id=eq."+encodeURIComponent(orderId),"DELETE");

        Logger.log("✅ Supabase 오더 삭제 완료 = "+orderId);
        return{success:true,orderId:orderId,result:result};
    }catch(e){
        Logger.log("❌ Supabase 오더 삭제 실패 = "+orderId+" / "+e.toString());
        return{success:false,orderId:orderId,error:e.toString()};
    }
}

function getSupabaseOrders(){
    try{
        return supabaseRequest("orders?select=*&order=created_at.desc","GET")||[];
    }catch(e){
        Logger.log("❌ Supabase 오더 조회 실패 = "+e.toString());
        return [];
    }
}

function testSupabaseOrdersConnection(){
    try{
        const data=getSupabaseOrders();
        Logger.log("========================================");
        Logger.log("🟢 Supabase orders 연결 테스트");
        Logger.log("오더 수 = "+data.length);
        Logger.log(JSON.stringify(data));
        Logger.log("========================================");
        return data;
    }catch(e){
        Logger.log("❌ Supabase orders 테스트 실패 = "+e.toString());
        return [];
    }
}

//==================================================
// Google Sheet 오더_DB ↔ Supabase orders 정합성 검사
// 사진 URL은 Markdown 포장 여부를 제거한 뒤 비교
// DB 자체는 수정하지 않음
//==================================================
function verifyGoogleSheetAndSupabaseOrders(){
    try{
        Logger.log("========================================");
        Logger.log("🔎 Google Sheet ↔ Supabase 오더 정합성 검사 시작");
        Logger.log("========================================");

        const sheetData=getOrderData();
        const supabaseData=getSupabaseOrders();

        if(!Array.isArray(sheetData)||sheetData.length<2){
            return{success:false,message:"Google Sheet 오더 데이터가 없습니다."};
        }

        if(!Array.isArray(supabaseData)){
            return{success:false,message:"Supabase 오더 데이터가 배열이 아닙니다."};
        }

        const sheetRows=sheetData.slice(1).filter(function(row){
            return row&&String(row[ORDER_COL.ORDER_ID]||"").trim()!=="";
        });

        const supabaseRows=supabaseData.filter(function(row){
            return row&&String(row.order_id||"").trim()!=="";
        });

        const sheetMap={};
        const supabaseMap={};

        sheetRows.forEach(function(row){
            const id=String(row[ORDER_COL.ORDER_ID]||"").trim();
            if(id)sheetMap[id]=row;
        });

        supabaseRows.forEach(function(row){
            const id=String(row.order_id||"").trim();
            if(id)supabaseMap[id]=row;
        });

        const missingInSupabase=[];
        const extraInSupabase=[];
        const fieldDifferences=[];
        const imageDifferences=[];
        let matched=0;

        Object.keys(sheetMap).forEach(function(orderId){
            if(!supabaseMap[orderId]){
                missingInSupabase.push(orderId);
                return;
            }

            const sheetRow=sheetMap[orderId];
            const sbRow=supabaseMap[orderId];
            const differences=[];

            function compareField(name,sheetValue,supabaseValue){
                const a=normalizeOrderCompareValue(sheetValue);
                const b=normalizeOrderCompareValue(supabaseValue);
                if(a!==b){
                    differences.push({
                        field:name,
                        sheet:a,
                        supabase:b
                    });
                }
            }

            compareField("register",sheetRow[ORDER_COL.REGISTER],sbRow.register);
            compareField("product",sheetRow[ORDER_COL.PRODUCT],sbRow.product);
            compareField("route",sheetRow[ORDER_COL.ROUTE],sbRow.route);
            compareField("assign_type",sheetRow[ORDER_COL.ASSIGN_TYPE],sbRow.assign_type);
            compareField("driver_id",sheetRow[ORDER_COL.DRIVER_ID],sbRow.driver_id);
            compareField("status",sheetRow[ORDER_COL.STATUS],sbRow.status);
            compareField("route_status",sheetRow[ORDER_COL.ROUTE_STATUS],sbRow.route_status);
            compareField("reject_driver",sheetRow[ORDER_COL.REJECT_DRIVER],sbRow.reject_driver);
            compareField("reject_time",sheetRow[ORDER_COL.REJECT_TIME],sbRow.reject_time);
            compareField("completed_time",sheetRow[ORDER_COL.COMPLETED_TIME],sbRow.completed_time);

            const sheetImage=normalizeDriveUrlList(sheetRow[ORDER_COL.IMAGE]);
            const sbImage=normalizeDriveUrlList(sbRow.image_url);

            const sheetThumb=normalizeDriveUrlList(sheetRow[ORDER_COL.THUMB]);
            const sbThumb=normalizeDriveUrlList(sbRow.thumb_url);

            if(JSON.stringify(sheetImage)!==JSON.stringify(sbImage)){
                imageDifferences.push({
                    orderId:orderId,
                    type:"image_url",
                    sheet:sheetImage,
                    supabase:sbImage
                });
            }

            if(JSON.stringify(sheetThumb)!==JSON.stringify(sbThumb)){
                imageDifferences.push({
                    orderId:orderId,
                    type:"thumb_url",
                    sheet:sheetThumb,
                    supabase:sbThumb
                });
            }

            if(differences.length>0){
                fieldDifferences.push({
                    orderId:orderId,
                    differences:differences
                });
            }else{
                matched++;
            }
        });

        Object.keys(supabaseMap).forEach(function(orderId){
            if(!sheetMap[orderId])extraInSupabase.push(orderId);
        });

        const result={
            success:true,
            sheetCount:sheetRows.length,
            supabaseCount:supabaseRows.length,
            matched:matched,
            missingInSupabase:missingInSupabase,
            extraInSupabase:extraInSupabase,
            fieldDifferences:fieldDifferences,
            imageDifferences:imageDifferences
        };

        Logger.log("========================================");
        Logger.log("📊 검사 결과");
        Logger.log("Google Sheet 오더 수 = "+sheetRows.length);
        Logger.log("Supabase 오더 수 = "+supabaseRows.length);
        Logger.log("기본 필드 완전 일치 = "+matched);
        Logger.log("Supabase에 없는 오더 = "+missingInSupabase.length);
        Logger.log("Supabase에만 존재하는 오더 = "+extraInSupabase.length);
        Logger.log("기본 필드 차이 오더 = "+fieldDifferences.length);
        Logger.log("사진 URL 차이 = "+imageDifferences.length);
        Logger.log("========================================");

        if(missingInSupabase.length>0){
            Logger.log("❌ Supabase 누락 order_id = "+JSON.stringify(missingInSupabase.slice(0,50)));
        }

        if(extraInSupabase.length>0){
            Logger.log("⚠️ Supabase에만 존재하는 order_id = "+JSON.stringify(extraInSupabase.slice(0,50)));
        }

        if(fieldDifferences.length>0){
            Logger.log("❌ 기본 필드 차이 샘플 = "+JSON.stringify(fieldDifferences.slice(0,20)));
        }

        if(imageDifferences.length>0){
            Logger.log("🖼️ 사진 URL 차이 샘플 = "+JSON.stringify(imageDifferences.slice(0,10)));
        }

        Logger.log("========================================");
        Logger.log("🔎 정합성 검사 종료");
        Logger.log("========================================");

        return result;

    }catch(e){
        Logger.log("❌ 정합성 검사 오류 = "+e.toString());
        return{
            success:false,
            message:e.toString()
        };
    }
}


//==================================================
// 비교용 값 정규화
//==================================================
function normalizeOrderCompareValue(value){
    if(value===null||value===undefined||value==="")return"";
    if(value instanceof Date){
        if(isNaN(value.getTime()))return"";
        return String(value.getTime());
    }
    const text=String(value).trim();
    if(!text)return"";
    const date=new Date(text);
    if(!isNaN(date.getTime())&&(text.indexOf("-")>=0||text.indexOf("T")>=0||text.indexOf(":")>=0)){
        return String(date.getTime());
    }
    return text;
}


//==================================================
// Drive URL / Markdown URL 정규화
// 실제 파일 URL 자체만 추출
//==================================================
function normalizeDriveUrlList(value){
    if(value===null||value===undefined||value==="")return[];

    return String(value).split("|").map(function(item){
        item=String(item||"").trim();
        if(!item)return"";

        const markdownMatch=item.match(/^\[([^\]]+)\]\((.+)\)$/);
        if(markdownMatch)item=markdownMatch[2];

        item=item.replace(/\\&/g,"&");

        return item.trim();
    }).filter(function(item){
        return item!=="";
    });
}

function syncSixMismatchedOrdersToSupabase(){
    try{
        const targetIds=[
            "OD260917-Y3HU2H",
            "OD260917-8GUPRE",
            "OD260917-VHRJZC",
            "OD260917-DAET5A",
            "OD260917-UK2MT5",
            "OD260917-9JPVY6"
        ];

        const data=getOrderData();
        if(!data||data.length<=1)throw new Error("Google Sheet 오더 데이터가 없습니다.");

        function toIsoUtc(value){
            if(value===null||value===undefined||value==="")return null;
            if(value instanceof Date){
                if(isNaN(value.getTime()))return null;
                return value.toISOString();
            }
            if(typeof value==="number"){
                const date=new Date(value);
                if(isNaN(date.getTime()))return null;
                return date.toISOString();
            }
            const text=String(value).trim();
            if(!text)return null;
            if(/^\d{10,13}$/.test(text)){
                const date=new Date(Number(text));
                if(!isNaN(date.getTime()))return date.toISOString();
            }
            const parsed=new Date(text);
            if(isNaN(parsed.getTime()))return null;
            return parsed.toISOString();
        }

        const targetMap={};
        targetIds.forEach(function(id){targetMap[id]=true;});

        let updated=0;
        let failed=0;
        const results=[];

        for(let i=1;i<data.length;i++){
            const row=data[i];
            if(!row)continue;

            const orderId=String(row[ORDER_COL.ORDER_ID]||"").trim();
            if(!targetMap[orderId])continue;

            const payload={
                register:String(row[ORDER_COL.REGISTER]||""),
                created_at:toIsoUtc(row[ORDER_COL.DATE]),
                product:String(row[ORDER_COL.PRODUCT]||""),
                route:String(row[ORDER_COL.ROUTE]||""),
                assign_type:String(row[ORDER_COL.ASSIGN_TYPE]||""),
                driver_id:String(row[ORDER_COL.DRIVER_ID]||""),
                status:String(row[ORDER_COL.STATUS]||"미확인"),
                image_url:String(row[ORDER_COL.IMAGE]||""),
                thumb_url:String(row[ORDER_COL.THUMB]||""),
                route_status:String(row[ORDER_COL.ROUTE_STATUS]||""),
                reject_driver:String(row[ORDER_COL.REJECT_DRIVER]||""),
                reject_time:toIsoUtc(row[ORDER_COL.REJECT_TIME]),
                completed_time:toIsoUtc(row[ORDER_COL.COMPLETED_TIME])
            };

            try{
                const result=supabaseRequest(
                    "orders?order_id=eq."+encodeURIComponent(orderId),
                    "PATCH",
                    payload
                );

                updated++;

                Logger.log(
                    "✅ Supabase 갱신 완료 = "+
                    orderId
                );

                results.push({
                    orderId:orderId,
                    success:true
                });

            }catch(err){
                failed++;

                Logger.log(
                    "❌ Supabase 갱신 실패 = "+
                    orderId+
                    " / "+
                    err.toString()
                );

                results.push({
                    orderId:orderId,
                    success:false,
                    error:err.toString()
                });
            }
        }

        Logger.log("========================================");
        Logger.log("🔄 기존 오더 6건 Supabase 강제 동기화 완료");
        Logger.log("갱신 성공 = "+updated);
        Logger.log("갱신 실패 = "+failed);
        Logger.log(JSON.stringify(results));
        Logger.log("========================================");

        return JSON.stringify({
            success:true,
            updated:updated,
            failed:failed,
            results:results
        });

    }catch(e){
        Logger.log("❌ 6건 강제 동기화 오류 = "+e.toString());
        return JSON.stringify({
            success:false,
            error:e.toString()
        });
    }
}

function syncOneOrderNow(){
    const orderId="OD260920-VSWHJR";
    try{
        Logger.log("========== 강제 Supabase 동기화 시작 ==========");
        Logger.log("orderId = "+orderId);
        SpreadsheetApp.flush();
        const sheet=getOrderSheet();
        if(!sheet)throw new Error("오더 시트를 찾을 수 없습니다.");
        const data=sheet.getDataRange().getValues();
        Logger.log("Sheet row count = "+data.length);
        let row=null;
        for(let i=1;i<data.length;i++){if(String(data[i][ORDER_COL.ORDER_ID]||"").trim()===orderId){row=data[i];break;}}
        if(!row)throw new Error("Sheet에서 오더를 찾을 수 없습니다: "+orderId);
        Logger.log("Sheet 상태 = "+String(row[ORDER_COL.STATUS]||""));
        Logger.log("Sheet 경유지상태 = "+String(row[ORDER_COL.ROUTE_STATUS]||""));
        Logger.log("Sheet 완료시간 = "+String(row[ORDER_COL.COMPLETED_TIME]||""));
        const orderData={
            order_id:String(row[ORDER_COL.ORDER_ID]||"").trim(),
            register:String(row[ORDER_COL.REGISTER]||""),
            created_at:row[ORDER_COL.DATE]||null,
            product:String(row[ORDER_COL.PRODUCT]||""),
            route:String(row[ORDER_COL.ROUTE]||""),
            assign_type:String(row[ORDER_COL.ASSIGN_TYPE]||"지정배차"),
            driver_id:String(row[ORDER_COL.DRIVER_ID]||""),
            status:String(row[ORDER_COL.STATUS]||"미확인"),
            image_url:String(row[ORDER_COL.IMAGE]||""),
            thumb_url:String(row[ORDER_COL.THUMB]||""),
            route_status:String(row[ORDER_COL.ROUTE_STATUS]||""),
            reject_driver:String(row[ORDER_COL.REJECT_DRIVER]||""),
            reject_time:row[ORDER_COL.REJECT_TIME]||null,
            completed_time:row[ORDER_COL.COMPLETED_TIME]||null
        };
        Logger.log("Supabase UPDATE 시작");
        const checkPath="orders?order_id=eq."+encodeURIComponent(orderId)+"&select=order_id";
        const existing=supabaseRequest(checkPath,"GET");
        Logger.log("기존 오더 존재 = "+(Array.isArray(existing)&&existing.length>0));
        if(!Array.isArray(existing)||existing.length===0)throw new Error("Supabase에서 해당 order_id를 찾지 못했습니다.");
        function toIsoUtc(value){
            if(value===null||value===undefined||value==="")return null;
            if(value instanceof Date)return isNaN(value.getTime())?null:value.toISOString();
            const text=String(value).trim();
            if(!text)return null;
            if(/^\d{10,13}$/.test(text)){const n=Number(text);const d=new Date(text.length===10?n*1000:n);return isNaN(d.getTime())?null:d.toISOString();}
            const d=new Date(text);
            if(isNaN(d.getTime()))throw new Error("날짜 변환 실패: "+text);
            return d.toISOString();
        }
        const payload={
            register:orderData.register,
            created_at:toIsoUtc(orderData.created_at),
            product:orderData.product,
            route:orderData.route,
            assign_type:orderData.assign_type,
            driver_id:orderData.driver_id,
            status:orderData.status,
            image_url:orderData.image_url,
            thumb_url:orderData.thumb_url,
            route_status:orderData.route_status,
            reject_driver:orderData.reject_driver,
            reject_time:toIsoUtc(orderData.reject_time),
            completed_time:toIsoUtc(orderData.completed_time)
        };
        Logger.log("UPDATE payload = "+JSON.stringify(payload));
        const updatePath="orders?order_id=eq."+encodeURIComponent(orderId);
        const result=supabaseRequest(updatePath,"PATCH",payload);
        Logger.log("Supabase UPDATE 완료");
        Logger.log("result = "+JSON.stringify(result));
        Logger.log("========== 강제 Supabase 동기화 종료 ==========");
        return true;
    }catch(e){
        Logger.log("❌ 강제 동기화 실패 = "+e.toString());
        Logger.log(e.stack||"stack 없음");
        Logger.log("========== 강제 Supabase 동기화 종료 ==========");
        return false;
    }
}