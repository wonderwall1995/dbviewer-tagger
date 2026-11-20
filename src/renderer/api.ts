// 화면은 이 모듈의 api만 부른다. window.electronAPI를 직접 부르지 않는다.
// 지금은 데스크톱(preload) 구현 하나뿐이다. Web 빌드에서는 HTTP 구현을 여기에 끼운다.
export const api: TaggerApi = window.electronAPI
