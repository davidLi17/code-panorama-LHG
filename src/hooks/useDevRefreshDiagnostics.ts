import {
  useSessionStorageState,
  useMount,
  useUnmount,
  useLatest,
  useEventListener,
  useMemoizedFn,
} from "ahooks";

/**
 * 诊断日志的附加负载数据
 */
type DiagnosticPayload = Record<string, unknown>;

/**
 * 单条开发环境诊断日志条目
 */
export type DevDiagnosticEntry = {
  /** 唯一 ID（时间戳 + 随机串） */
  id: string;
  /** ISO 格式的时间戳 */
  at: string;
  /** 日志类型（如 mount, unmount, visibilitychange, pagehide 等） */
  type: string;
  /** 可读的消息说明 */
  message: string;
  /** 关联的业务快照或环境数据 */
  payload?: DiagnosticPayload;
};

/**
 * 诊断 Hook 的初始化配置项
 */
type UseDevRefreshDiagnosticsOptions = {
  /** 当前被追踪的组件名称（用于日志筛选） */
  component: string;
  /** 获取当前组件业务状态快照的可选回调（如获取当前 Graph 的节点数等） */
  getSnapshot?: () => DiagnosticPayload;
};

/** 存储诊断日志的 SessionStorage 键名 */
const STORAGE_KEY = "code-panorama-dev-diagnostics";
/** 最大保留的日志条数（先进先出），平衡诊断深度与内存消耗 */
const MAX_ENTRIES = 40;

/**
 * 判断当前是否为开发环境
 */
function isDevEnvironment() {
  return process.env.NODE_ENV !== "production";
}

/**
 * 获取浏览器导航类型（用于分析页面刷新原因）
 */
function getNavigationType() {
  if (typeof window === "undefined") return "unknown";
  try {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return entry?.type || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 构建诊断日志条目
 */
function buildEntry(type: string, message: string, payload?: DiagnosticPayload): DevDiagnosticEntry {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    type,
    message,
    payload,
  };
}

/**
 * 开发环境热更新与生命周期诊断 Hook (修复版)
 * 使用 ahooks 优化并通过直接操作 Storage 解决卸载时数据丢失问题
 */
export function useDevRefreshDiagnostics(options: UseDevRefreshDiagnosticsOptions) {
  const enabled = isDevEnvironment();

  // 使用 ahooks 自动同步 sessionStorage 状态
  const [entries = [], setEntries] = useSessionStorageState<DevDiagnosticEntry[]>(STORAGE_KEY, {
    defaultValue: [],
    listenStorageChange: true,
  });

  // 保证回调中获取的是最新的配置
  const componentLatest = useLatest(options.component);
  const getSnapshotLatest = useLatest(options.getSnapshot);

  /**
   * 直接操作 Storage 的兜底逻辑，确保在组件卸载或页面关闭等异步机制失效的场景下日志依然能落盘
   */
  const persistEntryDirectly = useMemoizedFn((entry: DevDiagnosticEntry) => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      const current = raw ? JSON.parse(raw) : [];
      const next = [...current, entry].slice(-MAX_ENTRIES);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      console.debug("[dev-diagnostics]", entry);
    } catch {
      // ignore storage errors
    }
  });

  /**
   * 追加一条诊断记录 (使用 useMemoizedFn 保证引用稳定)
   */
  const append = useMemoizedFn((type: string, message: string, payload?: DiagnosticPayload) => {
    if (!enabled || typeof window === "undefined") return;
    const entry = buildEntry(type, message, payload);
    setEntries((prev = []) => [...prev, entry].slice(-MAX_ENTRIES));
    console.debug("[dev-diagnostics]", entry);
  });

  /**
   * 清除所有诊断记录 (使用 useMemoizedFn 保证引用稳定)
   */
  const clear = useMemoizedFn(() => {
    if (!enabled) return;
    setEntries([]);
    console.debug("[dev-diagnostics] cleared");
  });

  // 1. 挂载日志
  useMount(() => {
    if (!enabled) return;
    append("mount", `${componentLatest.current} mounted`, {
      navigationType: getNavigationType(),
      referrer: document.referrer || "",
      ...(getSnapshotLatest.current?.() || {}),
    });
  });

  // 2. 卸载日志 (关键修复：直接写入 Storage，避开 React 异步状态刷新导致的卸载数据丢失)
  useUnmount(() => {
    if (!enabled) return;
    const entry = buildEntry("unmount", `${componentLatest.current} unmounted`, getSnapshotLatest.current?.());
    persistEntryDirectly(entry);
  });

  // 3. 页面事件监听 (基于 useEventListener 自动清理)
  useEventListener(
    "visibilitychange",
    () => {
      append("visibilitychange", `document visibility=${document.visibilityState}`, getSnapshotLatest.current?.());
    },
    { target: () => window },
  );

  useEventListener(
    "pageshow",
    (event: PageTransitionEvent) => {
      append("pageshow", `pageshow persisted=${event.persisted ? "true" : "false"}`, {
        navigationType: getNavigationType(),
        persisted: event.persisted,
        ...(getSnapshotLatest.current?.() || {}),
      });
    },
    { target: () => window },
  );

  useEventListener(
    "pagehide",
    (event: PageTransitionEvent) => {
      // 页面隐藏/跳转属于高危操作，直接落盘
      const entry = buildEntry("pagehide", `pagehide persisted=${event.persisted ? "true" : "false"}`, {
        navigationType: getNavigationType(),
        persisted: event.persisted,
        ...(getSnapshotLatest.current?.() || {}),
      });
      persistEntryDirectly(entry);
    },
    { target: () => window },
  );

  useEventListener(
    "beforeunload",
    () => {
      // 刷新前夕，必须同步落盘
      const entry = buildEntry("beforeunload", "beforeunload fired", getSnapshotLatest.current?.());
      persistEntryDirectly(entry);
    },
    { target: () => window },
  );

  return {
    enabled,
    entries,
    append,
    clear,
  };
}
