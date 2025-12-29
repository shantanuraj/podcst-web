import type { Messages } from './en';

export const messages: Messages = {
  common: {
    appName: 'Podcst',
    version: '버전',
    madeBy: '제작:',
    author: '샨타누 라즈',
    loading: '로딩 중...',
    error: '문제가 발생했습니다',
  },

  nav: {
    discover: '둘러보기',
    library: '라이브러리',
    settings: '설정',
    profile: '프로필',
    signIn: '로그인',
    signOut: '로그아웃',
  },

  search: {
    placeholder: '팟캐스트 검색...',
    episodesPlaceholder: '에피소드 검색...',
    noResults: '검색 결과가 없습니다',
    label: '팟캐스트 검색',
  },

  auth: {
    title: '로그인',
    subtitle: '이메일을 입력하여 계속하세요',
    emailPlaceholder: 'you@example.com',
    continue: '계속하기',
    continuing: '계속하는 중...',
    useADifferentEmail: '다른 이메일 사용하기',
    verifyTitle: '이메일 인증',
    verifySubtitle: '{email} 주소로 인증 코드를 보냈습니다',
    codePlaceholder: '000000',
    enterCode: '인증 코드 입력',
    verify: '인증하기',
    verifying: '인증 중...',
    resendCode: '코드 다시 보내기',
    resending: '다시 보내는 중...',
    codeSent: '새 코드가 전송되었습니다!',
    createPasskey: '대신 패스키 사용하기',
  },

  settings: {
    title: '설정',
    language: '언어',
    languageDescription: '인터페이스 언어',
    region: '지역',
    regionDescription: '팟캐스트 순위 차트 지역을 선택하세요',
    theme: '테마',
    themeDescription: 'Podcst의 디자인을 설정하세요',
    shortcuts: '단축키',
    shortcutsDescription: '단축키 보기 및 관리',
    export: '내보내기',
    exportDescription: '라이브러리를 OPML 파일로 다운로드하세요',
    exportDescriptionLong:
      '구독 목록을 다른 앱에서 사용할 수 있도록 OPML 파일로 다운로드합니다.',
    emptyLibrary: '라이브러리가 비어 있습니다',
    emptyLibraryDescription:
      '팟캐스트를 구독하여 나만의 라이브러리를 만들거나, 다른 앱에서 구독 목록을 가져오세요.',
    browsePopularPodcasts: '인기 팟캐스트 둘러보기',
    exportLibrary: '라이브러리 내보내기',
    exportLibraryDescription:
      '라이브러리를 OPML 파일로 다운로드합니다. 이 파일을 사용하여 다른 앱에서 팟캐스트를 가져올 수 있습니다.',
    exportLibraryCta: 'OPML 파일 다운로드',
    exportLibraryCount: '라이브러리에 {count}개의 팟캐스트가 있습니다',
  },

  profile: {
    title: '프로필',
    account: '계정',
    subscriptions: '구독',
    syncDescription:
      '이 기기에 {count}개의 팟캐스트가 저장되어 있습니다. 계정에 가져오기하여 모든 기기에서 동기화하세요.',
    importFromDevice: '기기에서 가져오기',
    importing: '가져오는 중...',
    downloadOPML: 'OPML 다운로드',
  },

  player: {
    nowPlaying: '현재 재생 중',
    play: '재생',
    pause: '일시정지',
    resume: '재개',
    seekBack: '뒤로 이동',
    seekForward: '앞으로 이동',
    speed: '재생 속도',
    mute: '음소거',
    unmute: '음소거 해제',
    queue: '대기열 보기',
    airplay: 'AirPlay',
    chromecast: 'Cast',
  },

  podcast: {
    subscribe: '구독',
    subscribed: '구독 중',
    unsubscribe: '구독 취소',
    episodes: '에피소드',
    showNotes: '에피소드 정보',
    playEpisode: '에피소드 재생',
    addToQueue: '대기열에 추가',
    share: '공유하기',
    episodeCount: '{count, plural, other {#개의 에피소드}}',
    episodeSearchCount: '{total}개 중 {count}개의 에피소드',
    sort: '정렬:',
    sortOptions: {
      releaseDesc: '출시일 (최신순)',
      releaseAsc: '출시일 (오래된순)',
      titleAsc: '제목 (가나다순)',
      titleDesc: '제목 (ㅎ-ㄱ순)',
      lengthAsc: '길이 (짧은순)',
      lengthDesc: '길이 (긴순)',
    },
    loadingEpisodes: '에피소드 로딩 중...',
    loadError: '에피소드 로드 실패',
    loadingMore: '더 불러오는 중...',
    allLoaded: '모든 에피소드를 불러왔습니다',
  },

  library: {
    title: '라이브러리',
    empty: '아직 구독한 팟캐스트가 없습니다',
    emptyDescription: '팟캐스트를 구독하면 여기에 표시됩니다',
    recents: '최근 재생',
    subscriptions: '구독 목록',
  },

  feed: {
    trending: '트렌딩',
    topPodcasts: '인기 차트',
    newReleases: '새로운 에피소드',
  },

  queue: {
    title: '대기열',
    empty: '대기열에 에피소드를 추가하면 여기에 표시됩니다',
  },

  regions: {
    us: '미국',
    nl: '네덜란드',
    ca: '캐나다',
    kr: '대한민국',
    my: '말레이시아',
    in: '인도',
    mx: '멕시코',
    fr: '프랑스',
    se: '스웨덴',
    no: '노르웨이',
  },

  languages: {
    en: '영어',
    nl: '네덜란드어',
    fr: '프랑스어',
    sv: '스웨덴어',
    ko: '한국어',
    es: '스페인어',
    hi: '힌디어',
  },

  shortcuts: {
    home: '홈 / 인기',
    subscriptions: '구독 목록',
    recents: '최근 재생',
    settings: '설정',
    search: '검색',
    toggleTheme: '테마 전환',
    previousTheme: '이전 테마',
    showEpisodeInfo: '에피소드 정보 보기',
    queue: '대기열',
    playPause: '재생 / 일시정지',
    seekBack: '뒤로 이동',
    seekAhead: '앞으로 이동',
    seekToPercent: 'n %로 이동',
    nextEpisode: '다음 에피소드',
    previousEpisode: '이전 에피소드',
    increaseSpeed: '재생 속도 올리기',
    decreaseSpeed: '재생 속도 낮추기',
    toggleMute: '음소거 전환',
    showShortcuts: '단축키 보기',
  },

  themes: {
    autumnLight: '가을 햇살 (밝음)',
    autumnDark: '가을 밤 (어두움)',
    lightBlurb: '깔끔하고 밝은 화면',
    darkBlurb: '어두운 환경에 최적화됨',
  },

  errors: {
    notFound: '페이지를 찾을 수 없습니다',
    notFoundDescription: '찾으시는 페이지가 존재하지 않거나 이동되었습니다',
    goHome: '홈으로 이동',
  },
};
