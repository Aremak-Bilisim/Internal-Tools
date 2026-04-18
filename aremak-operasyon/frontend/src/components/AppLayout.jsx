import React, { useState } from 'react'
import { Layout, Menu, Button, Avatar, Dropdown, Typography } from 'antd'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  DashboardOutlined,
  InboxOutlined,
  ShoppingCartOutlined,
  SendOutlined,
  LogoutOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/products', icon: <InboxOutlined />, label: 'Ürünler' },
  { key: '/orders', icon: <ShoppingCartOutlined />, label: 'Siparişler' },
  { key: '/shipments', icon: <SendOutlined />, label: 'Sevk Talepleri' },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)

  const userMenu = {
    items: [{ key: 'logout', icon: <LogoutOutlined />, label: 'Çıkış Yap', danger: true }],
    onClick: ({ key }) => { if (key === 'logout') { logout(); navigate('/login') } },
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="dark" width={220}>
        <div style={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid #1f3a6e' }}>
          <Text strong style={{ color: '#fff', fontSize: collapsed ? 12 : 16 }}>
            {collapsed ? 'AO' : 'Aremak Operasyon'}
          </Text>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ marginTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderBottom: '1px solid #f0f0f0' }}>
          <Dropdown menu={userMenu} placement="bottomRight">
            <Button type="text" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Avatar size="small" icon={<UserOutlined />} />
              <span>{user?.name}</span>
            </Button>
          </Dropdown>
        </Header>

        <Content style={{ margin: 24, minHeight: 280 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
