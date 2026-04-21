import React, { useState, useEffect, useRef } from 'react'
import { Layout, Menu, Button, Avatar, Dropdown, Typography, Badge, Popover, List, Empty } from 'antd'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import {
  DashboardOutlined,
  InboxOutlined,
  ShoppingCartOutlined,
  SendOutlined,
  LogoutOutlined,
  UserOutlined,
  BellOutlined,
  SearchOutlined,
  PlusOutlined,
  TeamOutlined,
  EditOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../store/auth'
import api from '../services/api'

const { Header, Sider, Content } = Layout
const { Text } = Typography

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/products', icon: <InboxOutlined />, label: 'Ürünler' },
  {
    key: 'siparisler',
    icon: <ShoppingCartOutlined />,
    label: 'Siparişler',
    children: [
      { key: '/orders', icon: <ShoppingCartOutlined />, label: 'Müşteri Siparişleri' },
    ],
  },
  { key: '/shipments', icon: <SendOutlined />, label: 'Sevkiyatlar' },
  {
    key: 'musteri',
    icon: <TeamOutlined />,
    label: 'Müşteri',
    children: [
      { key: '/customer-query', icon: <SearchOutlined />, label: 'Firma Sorgula' },
      { key: '/customer-new', icon: <PlusOutlined />, label: 'Yeni Oluştur' },
      { key: '/customer-edit', icon: <EditOutlined />, label: 'Firma Güncelle' },
    ],
  },
]

export default function AppLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const [collapsed, setCollapsed] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const pollRef = useRef(null)

  const loadNotifications = () => {
    api.get('/notifications').then(r => setNotifications(r.data)).catch(() => {})
  }

  useEffect(() => {
    loadNotifications()
    pollRef.current = setInterval(loadNotifications, 30000)
    return () => clearInterval(pollRef.current)
  }, [])

  const unreadCount = notifications.filter(n => !n.is_read).length

  const markAllRead = () => {
    api.post('/notifications/read-all').then(() => {
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    })
  }

  const handleNotifClick = (notif) => {
    if (!notif.is_read) {
      api.post(`/notifications/${notif.id}/read`).then(() => {
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n))
      })
    }
    if (notif.shipment_id) {
      navigate(`/shipments/${notif.shipment_id}`)
      setNotifOpen(false)
    }
  }

  const notifContent = (
    <div style={{ width: 320 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Typography.Text strong>Bildirimler</Typography.Text>
        {unreadCount > 0 && (
          <Button type="link" size="small" onClick={markAllRead} style={{ padding: 0 }}>
            Tümünü okundu işaretle
          </Button>
        )}
      </div>
      {notifications.length === 0 ? (
        <Empty description="Bildirim yok" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          dataSource={notifications}
          style={{ maxHeight: 400, overflowY: 'auto' }}
          renderItem={(n) => (
            <List.Item
              onClick={() => handleNotifClick(n)}
              style={{
                cursor: n.shipment_id ? 'pointer' : 'default',
                background: n.is_read ? 'transparent' : '#e6f4ff',
                padding: '8px 12px',
                borderRadius: 6,
                marginBottom: 4,
              }}
            >
              <List.Item.Meta
                title={<Typography.Text style={{ fontSize: 13, fontWeight: n.is_read ? 400 : 600 }}>{n.title}</Typography.Text>}
                description={
                  <div>
                    {n.message && <div style={{ fontSize: 12, color: '#666' }}>{n.message}</div>}
                    <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
                      {n.created_at ? new Date(n.created_at.endsWith('Z') ? n.created_at : n.created_at + 'Z').toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : ''}
                    </div>
                  </div>
                }
              />
            </List.Item>
          )}
        />
      )}
    </div>
  )

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
          defaultOpenKeys={['siparisler', 'musteri']}
          items={menuItems}
          onClick={({ key }) => { if (key.startsWith('/')) navigate(key) }}
          style={{ marginTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderBottom: '1px solid #f0f0f0' }}>
          <Popover content={notifContent} trigger="click" open={notifOpen} onOpenChange={setNotifOpen} placement="bottomRight">
            <Badge count={unreadCount} size="small">
              <Button type="text" icon={<BellOutlined style={{ fontSize: 18 }} />} />
            </Badge>
          </Popover>
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
