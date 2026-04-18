import React, { useEffect, useState } from 'react'
import { Row, Col, Card, Statistic, Table, Spin, Typography } from 'antd'
import { InboxOutlined, ShoppingCartOutlined, SendOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../services/api'

const { Title } = Typography

export default function DashboardPage() {
  const [products, setProducts] = useState(null)
  const [orders, setOrders] = useState(null)
  const [shipments, setShipments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/products?pagesize=1'),
      api.get('/orders?pagesize=1'),
      api.get('/shipments'),
    ]).then(([p, o, s]) => {
      setProducts(p.data)
      setOrders(o.data)
      setShipments(s.data)
    }).finally(() => setLoading(false))
  }, [])

  const stageCounts = shipments.reduce((acc, s) => {
    acc[s.stage_label] = (acc[s.stage_label] || 0) + 1
    return acc
  }, {})
  const stageChartData = Object.entries(stageCounts).map(([name, value]) => ({ name, value }))

  const pendingShipments = shipments.filter((s) => s.stage !== 'shipped')

  const shipmentColumns = [
    { title: 'Müşteri', dataIndex: 'customer_name', key: 'customer_name' },
    { title: 'Kargo', dataIndex: 'cargo_company', key: 'cargo_company' },
    {
      title: 'Aşama',
      dataIndex: 'stage_label',
      key: 'stage_label',
      render: (v) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    { title: 'Oluşturulma', dataIndex: 'created_at', key: 'created_at', render: (v) => v?.slice(0, 10) },
  ]

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>Dashboard</Title>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Toplam Ürün" value={products?.count ?? '-'} prefix={<InboxOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Toplam Sipariş" value={orders?.OrderCount ?? '-'} prefix={<ShoppingCartOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Aktif Sevk Talebi" value={pendingShipments.length} prefix={<SendOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Tamamlanan Sevkiyat"
              value={shipments.filter((s) => s.stage === 'shipped').length}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="Sevk Talebi Aşamaları">
            {stageChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stageChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#1a56db" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p style={{ textAlign: 'center', color: '#999' }}>Henüz sevk talebi yok</p>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Bekleyen Sevk Talepleri">
            <Table
              dataSource={pendingShipments.slice(0, 5)}
              columns={shipmentColumns}
              rowKey="id"
              pagination={false}
              size="small"
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
