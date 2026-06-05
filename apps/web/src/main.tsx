import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import { AuthProvider } from './auth';
import { AppListProvider } from './AppContext';
import { kintsugiTheme } from './theme';
import { NotifyBridge } from './notify';
import { ErrorBoundary } from './ErrorBoundary';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN} theme={kintsugiTheme}>
      <AntdApp message={{ duration: 2.4 }} notification={{ placement: 'topRight' }}>
        <NotifyBridge />
        <ErrorBoundary>
          <BrowserRouter
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <AuthProvider>
              <AppListProvider>
                <App />
              </AppListProvider>
            </AuthProvider>
          </BrowserRouter>
        </ErrorBoundary>
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
