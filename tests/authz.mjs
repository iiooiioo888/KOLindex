// 角色 → 能力。角色只由伺服器（KOL_ROLE）決定，前端不能自選。
// viewer   只讀：任何非 GET/HEAD 都拒絕
// reviewer 審核：只多兩個寫入（裁決、AI 事件 ack）
// operator 操作者：所有 /api/* 寫入
export const ROLES = ['viewer', 'reviewer', 'operator'];

export const ROLE_LABEL = { viewer: '只讀', reviewer: '審核', operator: '操作者' };

const WRITE_RULES = {
  viewer: [],
  reviewer: [/^\/api\/review\/[^/]+\/verdict$/, /^\/api\/ai\/events\/[^/]+\/ack$/],
  operator: [/^\/api\//],
};

export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return ROLES.includes(r) ? r : 'viewer';
}

export function pathOf(rawUrl) {
  try {
    return new URL(String(rawUrl || '/'), 'http://local').pathname;
  } catch {
    return '/';
  }
}

export function isReadMethod(method) {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

// 寫入才檢查；讀取一律放行（登入由呼叫端先擋）。
export function apiAllowed(role, method, rawUrl) {
  if (isReadMethod(method)) return true;
  const p = pathOf(rawUrl);
  if (!p.startsWith('/api/')) return false;
  return WRITE_RULES[normalizeRole(role)].some((re) => re.test(p));
}

// 給前端顯示用；不參與授權判斷。
export function caps(role) {
  const r = normalizeRole(role);
  return {
    read: true,
    // write 專指「一般寫入」（派工、抓取、下載、收集認領）；審核裁決走 review。
    write: r === 'operator',
    review: r === 'reviewer' || r === 'operator',
    operate: r === 'operator',
  };
}

// 供錯誤訊息指出「這個角色只能做什麼」。
export function describe(role) {
  const r = normalizeRole(role);
  if (r === 'operator') return '操作者：可讀可寫';
  if (r === 'reviewer') return '審核：只讀＋人工裁決（review verdict／ai event ack）';
  return '只讀：不能寫入';
}
