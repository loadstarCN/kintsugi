import * as React from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: React.ReactNode;
}

interface State {
  err: Error | null;
}

/**
 * 顶层 ErrorBoundary：拦住任意页面的 render 错误，给一个"刷新 / 回首页"的可恢复界面，
 * 不让用户看到白屏。日志通过 console.error 留在浏览器开发者工具里，方便回报。
 *
 * 注意：这只挡 render 阶段抛错；async 错误（fetch / promise）要各页面自己 try-catch
 * 或 message.error。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  override state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  override componentDidCatch(err: Error, info: React.ErrorInfo): void {
    console.error('[Kintsugi ErrorBoundary]', err, info.componentStack);
  }

  reset = (): void => {
    this.setState({ err: null });
  };

  goHome = (): void => {
    window.location.href = '/';
  };

  override render(): React.ReactNode {
    if (this.state.err) {
      return (
        <Result
          status="500"
          title="页面渲染出错"
          subTitle={this.state.err.message || 'Unknown error'}
          extra={[
            <Button key="reload" type="primary" onClick={() => window.location.reload()}>
              刷新页面
            </Button>,
            <Button key="home" onClick={this.goHome}>
              回首页
            </Button>,
            <Button key="reset" onClick={this.reset}>
              重试
            </Button>,
          ]}
          style={{ paddingTop: 64 }}
        />
      );
    }
    return this.props.children;
  }
}
