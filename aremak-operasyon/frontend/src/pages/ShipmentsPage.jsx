import React, { useEffect, useState, useMemo } from 'react'
import { Table, Card, Tag, Button, Typography, Tabs, DatePicker, Select, Space } from 'antd'
import { EyeOutlined, ThunderboltOutlined, ClearOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/auth'
import HepsiburadaShipmentModal from '../components/HepsiburadaShipmentModal'

const { RangePicker } = DatePicker

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
  const [dateRange, setDateRange] = useState(null)
  const [archiveStatusFilter, setArchiveStatusFilter] = useState([])
  const [hbModalOpen, setHbModalOpen] = useState(false)

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

  // Arşiv durum seçenekleri (gerçek veriden)
  const archiveStatusOptions = useMemo(() => {
    const set = new Set()
    allShipments.forEach((s) => {
      if (s.is_archive && s.stage_label && s.stage_label !== '—') set.add(s.stage_label)
    })
    return Array.from(set).sort().map((v) => ({ value: v, label: v }))
  }, [allShipments])

  // Filter (date range + archive status)
  const filteredShipments = useMemo(() => {
    const fromDate = dateRange?.[0]?.format('YYYY-MM-DD')
    const toDate = dateRange?.[1]?.format('YYYY-MM-DD')
    const statusSet = archiveStatusFilter.length ? new Set(archiveStatusFilter) : null
    return shipments.filter((s) => {
      const dt = (s.created_at || '').slice(0, 10)
      if (fromDate && dt && dt < fromDate) return false
      if (toDate && dt && dt > toDate) return false
      if (statusSet && s.is_archive && !statusSet.has(s.stage_label)) return false
      return true
    })
  }, [shipments, dateRange, archiveStatusFilter])

  const isMyTurn = (shipment) => {
    if (!user) return false
    const myStages = MY_STAGES[user.role] || []
    return myStages.includes(shipment.stage)
  }

  const columns = [
    {
      title: 'Müşteri', dataIndex: 'customer_name', key: 'customer_name',
      render: (v, r) => (
        <Space size={6}>
          <span>{v || '-'}</span>
          {r.is_archive && <Tag color="blue" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>ARŞİV</Tag>}
        </Space>
      ),
    },
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
        <Button
          icon={<EyeOutlined />}
          size="small"
          onClick={() => navigate(r.is_archive ? `/shipments/archive/${r.archive_id}` : `/shipments/${r.id}`)}
        >
          Detay
        </Button>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>Satış Sevkleri</Title>
        {['admin', 'sales', 'warehouse'].includes(user?.role) && (
          <Button type="primary" onClick={() => setHbModalOpen(true)}>
            Hepsiburada Sevki Oluştur
          </Button>
        )}
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

        {/* Filtreler */}
        <Space wrap style={{ marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: '#666' }}>Tarih:</span>
          <RangePicker
            value={dateRange}
            onChange={setDateRange}
            format="DD.MM.YYYY"
            allowClear
            placeholder={['Başlangıç', 'Bitiş']}
          />
          <span style={{ fontSize: 13, color: '#666', marginLeft: 8 }}>Arşiv durum:</span>
          <Select
            mode="multiple"
            value={archiveStatusFilter}
            onChange={setArchiveStatusFilter}
            options={archiveStatusOptions}
            placeholder="Tümü"
            allowClear
            maxTagCount="responsive"
            style={{ minWidth: 240 }}
          />
          {(dateRange || archiveStatusFilter.length > 0) && (
            <Button icon={<ClearOutlined />} size="small" onClick={() => { setDateRange(null); setArchiveStatusFilter([]) }}>
              Temizle
            </Button>
          )}
          <span style={{ marginLeft: 8, color: '#888', fontSize: 12 }}>
            {filteredShipments.length} / {shipments.length}
          </span>
        </Space>

        <Table
          dataSource={filteredShipments}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `${t} talep` }}
          size="middle"
          rowClassName={(r) => isMyTurn(r) ? 'row-my-turn' : ''}
        />
      </Card>

      <HepsiburadaShipmentModal
        open={hbModalOpen}
        onClose={() => setHbModalOpen(false)}
        onCreated={(id) => navigate(`/shipments/${id}`)}
      />
    </div>
  )
}
