// 抖音创作者平台选择器集中管理。
// UI 变更时优先改这里；后续支持云端签名热修（M4）。
export const DOUYIN_CREATOR_HOME = 'https://creator.douyin.com';

export const DOUYIN_SELECTORS = {
  // 二维码元素候选（多策略，含 iframe 内）
  qrCandidates: [
    'img[src*="qrcode"]',
    'img[src*="qr_code"]',
    '[class*="qrcode"] img',
    '[class*="qr-code"] img',
    '.qrcode-img',
    '[class*="qrcode"] canvas',
    'canvas',
  ],
  // 扫码成功提示（手机上确认阶段）
  scannedIndicators: ['text=扫码成功', 'text=扫描成功', '[class*="scan-success"]'],
  // 短信验证墙（注意：登录页有"短信登录"tab，纯文本匹配会误报，只认输入框）
  smsIndicators: [
    'input[placeholder*="验证码"]',
    'input[placeholder*="短信"]',
    'input[placeholder*="校验"]',
  ],
  // 登录成功（创作者中心首页头像等）
  loggedInIndicators: [
    '[data-e2e="user-avatar"]',
    '.semi-avatar',
    'header [class*="avatar"]',
    '[class*="user-avatar"]',
  ],
  // 用户信息抓取
  profile: {
    nickname: [
      '[data-e2e="user-name"]',
      '.user-name',
      '[class*="nickname"]',
      'header [class*="name"]',
    ],
    avatar: ['[data-e2e="user-avatar"] img', '.semi-avatar img', 'header img[class*="avatar"]'],
  },
  // 登录路径特征（URL 判定辅助）
  loginPathPattern: /login|passport|sso/i,
  // 图文发布页（2026-10 实测结构：文件输入隐藏、草稿按钮叫"暂存离开"、发布按钮需精确匹配）
  publish: {
    url: 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3',
    fileInputs: ['input[type="file"][accept*="image"]', 'input[type="file"]'],
    uploadEntryButtons: ['button:has-text("上传图文")'],
    clearResetButtons: ['button:has-text("清空并重新上传")'],
    titleInputs: ['input[placeholder*="标题"]'],
    bodyEditors: ['div[contenteditable="true"]', '[contenteditable="true"].zone-container'],
    uploadingIndicator: ['text=上传中', '[class*="uploading"]'],
    saveDraftButtons: ['button:has-text("暂存离开")', 'button:has-text("存草稿")'],
    publishButtons: ['button:text-is("发布")'],
    finalConfirmButtons: ['button:text-is("发布")', 'button:has-text("确认发布")'],
    visibilityOptions: ['text=仅自己可见', 'text=仅自见'],
    successIndicators: ['text=发布成功', 'text=已发布', 'text=审核中'],
    // 发布弹窗里的安全验证墙（手机验证码/滑块）
    smsWallIndicators: [
      'text=安全验证',
      'text=发送验证码',
      'text=获取验证码',
      'input[placeholder*="验证码"]',
      '[class*="verify-code"]',
    ],
    topicSuggestion: ['[class*="suggest"]', '[class*="topic"] li', '[class*="dropdown"] [class*="item"]'],
  },
  // 作品管理页（对账）
  manage: {
    url: 'https://creator.douyin.com/creator-micro/content/manage',
    workLinkPatterns: [/\/video\//, /\/note\//, /\/slides\//],
    workCards: ['[data-e2e="work-item"]', '[class*="work-item"]', '[class*="content-item"]', '[class*="card"] a'],
  },
} as const;

export const LOGIN_POLL_INTERVAL_MS = 2000;
export const QR_EMIT_TTL_MS = 90_000;
export const SMS_WAIT_MS = 300_000;
export const LOGIN_TOTAL_TIMEOUT_MS = 15 * 60_000;
