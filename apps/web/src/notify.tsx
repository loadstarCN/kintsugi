import * as React from 'react';
import { App } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { NotificationInstance } from 'antd/es/notification/interface';

type MessageMethod = 'success' | 'error' | 'info' | 'warning' | 'loading';

let messageApi: MessageInstance | null = null;
let notificationApi: NotificationInstance | null = null;

/** 在 <AntdApp> 子树内挂一次，把 useApp() 动态主题的 imperative API 暴露给非组件代码（service / 副作用 / catch 分支）。 */
export function NotifyBridge(): null {
  const apis = App.useApp();
  React.useEffect(() => {
    messageApi = apis.message;
    notificationApi = apis.notification;
    return () => {
      messageApi = null;
      notificationApi = null;
    };
  }, [apis.message, apis.notification]);
  return null;
}

function delegate<K extends MessageMethod>(method: K): MessageInstance[K] {
  return ((...args: Parameters<MessageInstance[K]>) => {
    if (!messageApi) {
      // boot 之前打到这里的 toast 就只在 console 留痕；正常使用走不到
      console.warn(`[notify.${method}] called before <AntdApp> mounted`, args);
      return undefined as ReturnType<MessageInstance[K]>;
    }
    return (messageApi[method] as (...a: unknown[]) => ReturnType<MessageInstance[K]>)(...args);
  }) as unknown as MessageInstance[K];
}

export const message: Pick<MessageInstance, MessageMethod> = {
  success: delegate('success'),
  error: delegate('error'),
  info: delegate('info'),
  warning: delegate('warning'),
  loading: delegate('loading'),
};

export const notification = {
  open: ((cfg: Parameters<NotificationInstance['open']>[0]) =>
    notificationApi?.open(cfg)) as NotificationInstance['open'],
  success: ((cfg: Parameters<NotificationInstance['success']>[0]) =>
    notificationApi?.success(cfg)) as NotificationInstance['success'],
  error: ((cfg: Parameters<NotificationInstance['error']>[0]) =>
    notificationApi?.error(cfg)) as NotificationInstance['error'],
  info: ((cfg: Parameters<NotificationInstance['info']>[0]) =>
    notificationApi?.info(cfg)) as NotificationInstance['info'],
  warning: ((cfg: Parameters<NotificationInstance['warning']>[0]) =>
    notificationApi?.warning(cfg)) as NotificationInstance['warning'],
};
