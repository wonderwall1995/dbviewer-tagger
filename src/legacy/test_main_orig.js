// 보류 (LEGACY): 이 파일은 2026-10-14에 src/legacy로 옮겼다.
// 이유: Electron 기동 확인용 스크래치 파일이다. 앱에서 사용하지 않는다.

const e = require("electron");
console.log("type:", typeof e, "app:", typeof e.app);
e.app ? e.app.on("ready", () => { console.log("app ready!"); e.app.quit() }) : process.exit(0);
