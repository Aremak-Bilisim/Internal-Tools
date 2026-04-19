import React, { useEffect, useState } from 'react'
import { Table, Card, Tag, Button, Typography, Space, Tabs } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

const { Title } = Typography

const STAGE_COLORS = {
  draft: 'default',
  pending_admin: 'orange',
  preparing: 'blue',
  pending_waybill_approval: 'purple',
  ready_to_ship: 'cyan',
  shipped: 'green',
}

const STAGES = [
  { key: 'all', label: 'Tümü' },
  { key: 'pending_admin', label: 'Admin Onayı Bekleniyor' },
  { key: 'preparing', label: 'Hazırlanıyor' },
  { key: 'pending_waybill_approval', label: 'İrsaliye Onayı Bekleniyor' },
  { key: 'ready_to_ship', label: 'Sevke Hazır' },
  { key: 'shipped', label: 'Sevk Edildi' },
]

export default function ShipmentsPage() {
  const navigate = useNavigate()
  const [shipments, setShipments] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('all')

  const load = () => {
    setLoading(true)
    const params = activeStage !== 'all' ? `?stage=${activeStage}` : ''
    api.get(`/shipments${params}`)
      .then((r) => setShipments(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [activeStage])

  const columns = [
    { title: 'Müşteri', dataIndex: 'customer_name', key: 'customer_name' },
    { title: 'Sipariş', dataIndex: 'tg_order_name', key: 'tg_order_name', render: (v) => v || '-' },
    { title: 'Kargo', dataIndex: 'cargo_company', key: 'cargo_company' },
    {
      title: 'Aşama',
      dataIndex: 'stage_label',
      key: 'stage',
      render: (v, r) => <Tag color={STAGE_COLORS[r.stage]}>{v}</Tag>,
    },
    { title: 'Oluşturan', key: 'created_by', render: (_, r) => r.created_by?.name || '-' },
    { title: 'Tarih', dataIndex: 'created_at', key: 'created_at', render: (v) => v?.slice(0, 10) },
    {
      title: '',
      key: 'action',
      width: 80,
      render: (_, r) => (
        <Button icon={<EyeOutlined />} size="small" onClick={() => navigate(`/shipments/${r.id}`)}>
          Detay
        </Button>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Sevkiyatlar</Title>
      </div>

      <Card>
        <Tabs
          activeKey={activeStage}
          onChange={setActiveStage}
          items={STAGES.map((s) => ({ key: s.key, label: s.label }))}
          style={{ marginBottom: 16 }}
        />
        <Table
          dataSource={shipments}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `${t} talep` }}
          size="middle"
        />
      </Card>
    </div>
  )
}
