import React, { useEffect, useState } from 'react'
import { Table, Card, Tag, Button, Typography, Space, Tabs } from 'antd'
import { EyeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

const { Title } = Typography

const STAGE_COLORS = {
  pending_admin: 'orange',
  parasut_review: 'blue',
  pending_parasut_approval: 'purple',
  preparing: 'cyan',
  shipped: 'green',
  revizyon_bekleniyor: 'volcano',
  iptal_edildi: 'default',
}

const STAGE_LABELS = {
  pending_admin: 'Yönetici Onayı Bekleniyor',
  parasut_review: 'Paraşüt Kontrolü Yapılıyor',
  pending_parasut_approval: 'Paraşüt Onayı Bekleniyor',
  preparing: 'Sevk İçin Hazırlanıyor',
  shipped: 'Sevk Edildi',
  revizyon_bekleniyor: 'Revizyon Bekleniyor',
  iptal_edildi: 'İptal Edildi',
}

const STAGES = [
  { key: 'all', label: 'Tümü' },
  { key: 'revizyon_bekleniyor', label: 'Revizyon Bekleniyor' },
  { key: 'pending_admin', label: 'Yönetici Onayı Bekleniyor' },
  { key: 'parasut_review', label: 'Paraşüt Kontrolü' },
  { key: 'pending_parasut_approval', label: 'Paraşüt Onayı Bekleniyor' },
  { key: 'preparing', label: 'Sevke Hazırlanıyor' },
  { key: 'shipped', label: 'Sevk Edildi' },
  { key: 'iptal_edildi', label: 'İptal Edildi' },
]

export default function ShipmentsPage() {
  const navigate = useNavigate()
  const [shipments, setShipments] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('all')

  const loadCounts = () => {
    api.get('/shipments').then((r) => {
      const c = {}
      r.data.forEach((s) => { c[s.stage] = (c[s.stage] || 0) + 1 })
      c.all = r.data.length
      setCounts(c)
    }).catch(() => {})
  }

  const load = () => {
    setLoading(true)
    const params = activeStage !== 'all' ? `?stage=${activeStage}` : ''
    api.get(`/shipments${params}`)
      .then((r) => setShipments(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadCounts() }, [])
  useEffect(() => { load() }, [activeStage])

  const columns = [
    { title: 'Müşteri', dataIndex: 'customer_name', key: 'customer_name' },
    { title: 'Sipariş', dataIndex: 'tg_order_name', key: 'tg_order_name', render: (v) => v || '-' },
    { title: 'Sevk Şekli', dataIndex: 'delivery_type', key: 'delivery_type', render: (v) => v || '-' },
    {
      title: 'Aşama',
      dataIndex: 'stage_label',
      key: 'stage',
      render: (v, r) => <Tag color={STAGE_COLORS[r.stage]}>{STAGE_LABELS[r.stage] || v}</Tag>,
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
          items={STAGES.map((s) => ({
            key: s.key,
            label: counts[s.key] != null
              ? <span>{s.label} <span style={{ fontSize: 11, background: '#f0f0f0', borderRadius: 10, padding: '1px 7px', marginLeft: 4, color: '#666' }}>{counts[s.key]}</span></span>
              : s.label,
          }))}
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
