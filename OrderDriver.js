//==================================================
// 오더 화면 전용 기사정보 조회
// 기사ID / 이름 / 근무상태만 사용
// 기존 기사 DB, GPS, FCM, 로그인 로직은 건드리지 않음
// CacheService / PropertiesService 사용 안 함
//==================================================

function getOrderDriverList(){
    try{
        const result=supabaseRequest(
            "drivers?select=driver_id,name,work_status%26order=driver_id.asc",
            "GET"
        );

        const list=(Array.isArray(result)?result:[]).map(function(row){
            return{
                id:String(row.driver_id||"").trim(),
                name:String(row.name||"").trim(),
                status:String(row.work_status||"퇴근함").trim()
            };
        }).filter(function(driver){
            return driver.id!=="";
        });

        Logger.log("오더용 기사정보 조회 완료 = "+list.length+"명");
        return list;

    }catch(e){
        Logger.log("오더용 기사정보 조회 실패 = "+e.toString());
        return[];
    }
}