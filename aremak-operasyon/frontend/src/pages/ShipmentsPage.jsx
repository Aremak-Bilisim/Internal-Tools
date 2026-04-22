import React, { useEffect, useState, useMemo } from 'react'
import { Table, Card, Tag, Button, Typography, Tabs } from 'antd'
import { EyeOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

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

// Her aşamada kimin aksiyonu bekleniyor
const STAGE_ACTOR = {
  pending_admin: 'admin',
  parasut_review: 'warehouse',
  pending_parasut_approval: 'admin',
  preparing: 'warehouse',
  revizyon_bekleniyor: 'sales',
}

const STAGE_ACTOR_LABEL = {
  pending_admin: 'Admin',
  parasut_review: 'Sevk Sorumlusu',
  pending_parasut_approval: 'Admin',
  preparing: 'Sevk Sorumlusu',
  revizyon_bekleniyor: 'Satış',
}

// Hangi kullanıcı rolü hangi aşamaları "kendi aksiyonu" sayar
const MY_STAGES = {
  admin: ['pending_admin', 'pending_parasut_approval'],
  warehouse: ['parasut_review', 'preparing'],
  sales: ['revizyon_bekleniyor'],
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
  const { user } = useAuthStore()
  const [allShipments, setAllShipments] = useState([])
  const [shipments, setShipments] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('all')
  const [usersByRole, setUsersByRole] = useState({})

  const loadAll = () => {
    api.get('/shipments').then((r) => {
      setAllShipments(r.data)
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

  useEffect(() => {
    loadAll()
    api.get('/users').then((r) => {
      const byRole = {}
      r.data.forEach((u) => {
        if (!byRole[u.role]) byRole[u.role] = []
        byRole[u.role].push(u.name)
      })
      setUsersByRole(byRole)
    }).catch(() => {})
  }, [])
  useEffect(() => { load() }, [activeStage])

  // Giriş yapan kullanıcının aksiyonunu bekleyen talepler
  const myActionShipments = useMemo(() => {
    if (!user) return []
    const myStages = MY_STAGES[user.role] || []
    return allShipments.filter((s) => myStages.includes(s.stage))
  }, [allShipments, user])

  const isMyTurn = (shipment) => {
    if (!user) return false
    const myStages = MY_STAGES[user.role] || []
    return myStages.includes(shipment.stage)
  }

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
    {
      title: 'Bekleyen',
      key: 'actor',
      width: 140,
      render: (_, r) => {
        const actor = STAGE_ACTOR[r.stage]
        if (!actor) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        if (isMyTurn(r)) {
          return (
            <span style={{
              fontSize: 12, fontWeight: 600, color: '#d46b08',
              background: '#fff7e6', border: '1px solid #ffd591',
              borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap',
            }}>
              ⚡ Sıra Sende
            </span>
          )
        }
        const actorNames = usersByRole[actor]?.join(', ') || STAGE_ACTOR_LABEL[r.stage]
        return <Text type="secondary" style={{ fontSize: 12 }}>{actorNames}</Text>
      },
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
        <Title level={4} style={{ margin: 0 }}>Satış Sevkleri</Title>
      </div>

      {/* Aksiyon Kartları */}
      {myActionShipments.length > 0 && (
        <div style={{
          marginBottom: 16,
          padding: '14px 20px',
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderLeft: '4px solid #faad14',
          borderRadius: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ThunderboltOutlined style={{ color: '#d46b08', fontSize: 16 }} />
            <Text strong style={{ color: '#d46b08', fontSize: 14 }}>
              {myActionShipments.length} talep sizin aksiyonunuzu bekliyor
            </Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {myActionShipments.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: '#fff', borderRadius: 6, padding: '8px 12px',
                  border: '1px solid #ffd591',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Tag color={STAGE_COLORS[s.stage]} style={{ margin: 0, fontSize: 11 }}>
                    {STAGE_LABELS[s.stage]}
                  </Tag>
                  <Text style={{ fontSize: 13 }}>
                    <Text strong>{s.customer_name}</Text>
                    {s.tg_order_name && (
                      <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>· {s.tg_order_name}</Text>
                    )}
                  </Text>
                </div>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<EyeOutlined />}
                  onClick={() => navigate(`/shipments/${s.id}`)}
                >
                  Detay
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

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
          rowClassName={(r) => isMyTurn(r) ? 'row-my-turn' : ''}
        />
      </Card>
    </div>
  )
}
