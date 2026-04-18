import React from 'react'
import { Form, Input, Button, Card, Typography, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import api from '../services/api'

const { Title, Text } = Typography

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [loading, setLoading] = React.useState(false)

  const onFinish = async ({ email, password }) => {
    setLoading(true)
    try {
      const form = new URLSearchParams()
      form.append('username', email)
      form.append('password', password)
      const { data } = await api.post('/auth/login', form, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      setAuth(data.access_token, data.user)
      navigate('/dashboard')
    } catch {
      message.error('E-posta veya şifre hatalı')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f2f5' }}>
      <Card style={{ width: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={3} style={{ margin: 0 }}>Aremak Operasyon</Title>
          <Text type="secondary">Lütfen giriş yapın</Text>
        </div>
        <Form layout="vertical" onFinish={onFinish}>
          <Form.Item name="email" label="E-posta" rules={[{ required: true, type: 'email', message: 'Geçerli e-posta girin' }]}>
            <Input size="large" placeholder="ad@aremak.com.tr" />
          </Form.Item>
          <Form.Item name="password" label="Şifre" rules={[{ required: true, message: 'Şifre gerekli' }]}>
            <Input.Password size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Giriş Yap
          </Button>
        </Form>
      </Card>
    </div>
  )
}
