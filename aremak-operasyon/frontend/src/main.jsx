import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import trTR from 'antd/locale/tr_TR'
import App from './App'
import 'antd/dist/reset.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <ConfigProvider locale={trTR} theme={{ token: { colorPrimary: '#1a56db' } }}>
      <App />
    </ConfigProvider>
  </BrowserRouter>
)
