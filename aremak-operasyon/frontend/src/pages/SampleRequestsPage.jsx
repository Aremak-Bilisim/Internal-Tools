import React, { useEffect, useState, useMemo } from 'react'
import { Table, Card, Tag, Button, Typography, Tabs, Modal, Form, Select, Input, InputNumber, DatePicker, Space, Divider, Spin, message } from 'antd'
import { EyeOutlined, ThunderboltOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

const STAGE_COLORS = {
  pending_admin: 'orange',
  preparing: 'cyan',
  shipped: 'green',
  revizyon_bekleniyor: 'volcano',
  iptal_edildi: 'default',
}

const STAGE_LABELS = {
  pending_admin: 'Yönetici Onayı Bekleniyor',
  preparing: 'Sevk İçin Hazırlanıyor',
  shipped: 'Sevk Edildi',
  revizyon_bekleniyor: 'Revizyon Bekleniyor',
  iptal_edildi: 'İptal Edildi',
}

const STAGE_ACTOR = {
  pending_admin: 'admin',
  preparing: 'warehouse',
  revizyon_bekleniyor: 'sales',
}

const MY_STAGES = {
  admin: ['pending_admin'],
  warehouse: ['preparing'],
  sales: ['revizyon_bekleniyor'],
}

const STAGES = [
  { key: 'all', label: 'Tümü' },
  { key: 'revizyon_bekleniyor', label: 'Revizyon Bekleniyor' },
  { key: 'pending_admin', label: 'Yönetici Onayı Bekleniyor' },
  { key: 'preparing', label: 'Sevke Hazırlanıyor' },
  { key: 'shipped', label: 'Sevk Edildi' },
  { key: 'iptal_edildi', label: 'İptal Edildi' },
]

const CARGO_COMPANIES = ['Yurtiçi Kargo', 'Aras Kargo', 'MNG Kargo', 'PTT Kargo', 'Sürat Kargo', 'DHL', 'UPS']

export default function SampleRequestsPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [allSamples, setAllSamples] = useState([])
  const [samples, setSamples] = useState([])
  const [counts, setCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('all')

  // New sample modal
  const [modalOpen, setModalOpen] = useState(false)
  const [opportunities, setOpportunities] = useState([])
  const [oppsLoading, setOppsLoading] = useState(false)
  const [selectedOpp, setSelectedOpp] = useState(null)
  const [proposals, setProposals] = useState([])
  const [proposalsLoading, setProposalsLoading] = useState(false)
  const [oppItems, setOppItems] = useState([])
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const deliveryType = Form.useWatch('delivery_type', form)

  const loadAll = () => {
    api.get('/samples').then((r) => {
      setAllSamples(r.data)
      const c = {}
      r.data.forEach((s) => { c[s.stage] = (c[s.stage] || 0) + 1 })
      c.all = r.data.length
      setCounts(c)
    }).catch(() => {})
  }

  const load = () => {
    setLoading(true)
    const params = activeStage !== 'all' ? `?stage=${activeStage}` : ''
    api.get(`/samples${params}`)
      .then((r) => setSamples(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadAll() }, [])
  useEffect(() => { load() }, [activeStage])

  const myActionSamples = useMemo(() => {
    if (!user) return []
    const myStages = MY_STAGES[user.role] || []
    return allSamples.filter((s) => myStages.includes(s.stage))
  }, [allSamples, user])

  const isMyTurn = (sample) => {
    if (!user) return false
    return (MY_STAGES[user.role] || []).includes(sample.stage)
  }

  const openModal = () => {
    setModalOpen(true)
    setOppsLoading(true)
    api.get('/samples/opportunities')
      .then((r) => setOpportunities(r.data.List || []))
      .catch(() => message.error('Fırsatlar yüklenemedi'))
      .finally(() => setOppsLoading(false))
  }

  const handleOppSelect = (oppId) => {
    const opp = opportunities.find((o) => o.Id === oppId)
    if (!opp) return
    setSelectedOpp(opp)
    setProposals([])
    form.setFieldsValue({
      customer_name: opp.RelatedEntityName || opp.RelatedEntity?.Name || '',
      tg_proposal_id: undefined,
    })
    form.setFieldValue('items', [])
    setOppItems([])

    // Fırsata ait teklifleri yükle
    setProposalsLoading(true)
    api.get(`/samples/opportunities/${oppId}/proposals`)
      .then((r) => {
        const list = r.data.List || []
        setProposals(list)
        // Teklif yoksa fırsat kalemleri fallback
        if (list.length === 0) {
          const items = (opp.Items || []).map((item) => ({
            product_id: item.Product?.Id || null,
            product_name: item.Product?.Displayname || item.Title || '',
            quantity: item.Quantity || 1,
            shelf: '',
          }))
          setOppItems(items)
          form.setFieldValue('items', items)
        }
      })
      .catch(() => {})
      .finally(() => setProposalsLoading(false))
  }

  const parseAddress = (fullAddress) => {
    if (!fullAddress) return {}
    // Ülkeyi çıkar (Türkiye / Turkey)
    let addr = fullAddress.replace(/,?\s*(türkiye|turkey)\s*$/i, '').trim()
    // 5 haneli posta kodunu çıkar (sadece referans — kullanıcı manuel giriyor)
    addr = addr.replace(/,?\s*\d{5}\s*,?/g, (m) => m.startsWith(',') && m.endsWith(',') ? ',' : '').trim()
    addr = addr.replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim()
    // Virgülle böl
    const parts = addr.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length >= 3) {
      return {
        street: parts.slice(0, -2).join(', '),
        district: parts[parts.length - 2],
        city: parts[parts.length - 1],
      }
    }
    if (parts.length === 2) {
      // "İlçe/İl" formatı
      if (parts[1].includes('/')) {
        const [district, city] = parts[1].split('/').map((p) => p.trim())
        return { street: parts[0], district, city }
      }
      return { street: parts[0], city: parts[1] }
    }
    return { street: addr }
  }

  const handleProposalSelect = (proposalId) => {
    if (!proposalId) return
    // Proposals/Index sadece özet bilgi verir, Items için Proposals/Get gerekiyor
    api.get(`/samples/proposals/${proposalId}`)
      .then((r) => {
        const proposal = r.data

        // Ürünler
        const items = (proposal.Items || []).map((item) => ({
          product_id: item.Product?.Id || null,
          product_name: item.Product?.Displayname || item.Product?.Name || item.Title || '',
          quantity: item.Quantity || 1,
          shelf: '',
        }))
        setOppItems(items)

        // Teslimat adresi — parse et
        const rawAddress = proposal.DeliveryAddress || proposal.CustomerAddress || ''
        const { street, district, city } = parseAddress(rawAddress)
        const phone = proposal.CustomerPhone || proposal.CustomerMobile || ''
        const recipientName = proposal.Attn?.Displayname || proposal.Attn?.Name || ''

        form.setFieldsValue({
          items,
          delivery_address: street || rawAddress || undefined,
          delivery_district: district || undefined,
          delivery_city: city || undefined,
          recipient_phone: phone || undefined,
          recipient_name: recipientName || undefined,
        })
      })
      .catch(() => message.error('Teklif detayı yüklenemedi'))
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      setSubmitting(true)
      const opp = opportunities.find((o) => o.Id === values.tg_opportunity_id)
      const payload = {
        ...values,
        tg_opportunity_name: opp?.Title || opp?.RelatedEntityName || '',
        planned_ship_date: values.planned_ship_date ? dayjs(values.planned_ship_date).format('YYYY-MM-DD') : null,
      }
      await api.post('/samples', payload)
      message.success('Numune talebi oluşturuldu')
      setModalOpen(false)
      form.resetFields()
      setSelectedOpp(null)
      setOppItems([])
      loadAll()
      load()
    } catch (e) {
      if (e?.errorFields) return
      message.error('Hata oluştu')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    { title: 'Müşteri', dataIndex: 'customer_name', key: 'customer_name' },
    { title: 'Fırsat', dataIndex: 'tg_opportunity_name', key: 'tg_opportunity_name', render: (v) => v || '-' },
    { title: 'Sevk Şekli', dataIndex: 'delivery_type', key: 'delivery_type', render: (v) => v || '-' },
    {
      title: 'Aşama', dataIndex: 'stage_label', key: 'stage',
      render: (v, r) => <Tag color={STAGE_COLORS[r.stage]}>{STAGE_LABELS[r.stage] || v}</Tag>,
    },
    {
      title: 'Bekleyen', key: 'actor', width: 140,
      render: (_, r) => {
        if (!STAGE_ACTOR[r.stage]) return <Text type="secondary" style={{ fontSize: 12 }}>—</Text>
        if (isMyTurn(r)) {
          return (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#d46b08', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 4, padding: '2px 8px', whiteSpace: 'nowrap' }}>
              ⚡ Sıra Sende
            </span>
          )
        }
        return <Text type="secondary" style={{ fontSize: 12 }}>{STAGE_ACTOR[r.stage] === 'admin' ? 'Admin' : 'Sevk Sorumlusu'}</Text>
      },
    },
    { title: 'Oluşturan', key: 'created_by', render: (_, r) => r.created_by?.name || '-' },
    { title: 'Tarih', dataIndex: 'created_at', key: 'created_at', render: (v) => v?.slice(0, 10) },
    {
      title: '', key: 'action', width: 80,
      render: (_, r) => (
        <Button icon={<EyeOutlined />} size="small" onClick={() => navigate(`/samples/${r.id}`)}>Detay</Button>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>Giden Numune</Title>
        {(user?.role === 'admin' || user?.role === 'sales') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openModal}>Yeni Talep</Button>
        )}
      </div>

      {myActionSamples.length > 0 && (
        <div style={{ marginBottom: 16, padding: '14px 20px', background: '#fffbe6', border: '1px solid #ffe58f', borderLeft: '4px solid #faad14', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <ThunderboltOutlined style={{ color: '#d46b08', fontSize: 16 }} />
            <Text strong style={{ color: '#d46b08', fontSize: 14 }}>
              {myActionSamples.length} numune talebinde aksiyonunuz bekleniyor
            </Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {myActionSamples.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff', borderRadius: 6, padding: '8px 12px', border: '1px solid #ffd591' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Tag color={STAGE_COLORS[s.stage]} style={{ margin: 0, fontSize: 11 }}>{STAGE_LABELS[s.stage]}</Tag>
                  <Text style={{ fontSize: 13 }}>
                    <Text strong>{s.customer_name}</Text>
                    {s.tg_opportunity_name && <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>· {s.tg_opportunity_name}</Text>}
                  </Text>
                </div>
                <Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => navigate(`/samples/${s.id}`)}>Detay</Button>
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
          dataSource={samples}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showTotal: (t) => `${t} talep` }}
          size="middle"
          rowClassName={(r) => isMyTurn(r) ? 'row-my-turn' : ''}
        />
      </Card>

      <Modal
        title="Yeni Numune Talebi"
        open={modalOpen}
        onCancel={() => { setModalOpen(false); form.resetFields(); setSelectedOpp(null); setOppItems([]) }}
        onOk={handleSubmit}
        okText="Talep Oluştur"
        cancelText="Vazgeç"
        confirmLoading={submitting}
        width={680}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="TeamGram Fırsatı" name="tg_opportunity_id" rules={[{ required: true, message: 'Fırsat seçiniz' }]}>
            <Select
              showSearch
              loading={oppsLoading}
              placeholder="Fırsat seçin..."
              optionFilterProp="label"
              onChange={handleOppSelect}
              options={(opportunities || []).map((o) => ({
                value: o.Id,
                label: o.Displayname || o.Name || `Fırsat #${o.Id}`,
              }))}
            />
          </Form.Item>

          {selectedOpp && (
            <Form.Item
              label="Teklif"
              name="tg_proposal_id"
              extra={proposals.length === 0 && !proposalsLoading ? 'Bu fırsata ait teklif bulunamadı, fırsat kalemleri kullanılacak.' : null}
            >
              <Select
                loading={proposalsLoading}
                placeholder="Teklif seçin (opsiyonel)..."
                allowClear
                onChange={handleProposalSelect}
                options={(proposals).map((p) => ({
                  value: p.Id,
                  label: p.Displayname || p.Name || `Teklif #${p.Id}`,
                }))}
              />
            </Form.Item>
          )}

          <Form.Item label="Müşteri Adı" name="customer_name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>

          <Form.Item label="Sevk Şekli" name="delivery_type">
            <Select options={[{ value: 'Ofis Teslim' }, { value: 'Kargo' }]} placeholder="Seçin..." allowClear />
          </Form.Item>

          {deliveryType === 'Kargo' && (
            <Form.Item label="Kargo Firması" name="cargo_company">
              <Select options={CARGO_COMPANIES.map((c) => ({ value: c }))} placeholder="Kargo firması seçin..." allowClear />
            </Form.Item>
          )}

          <Form.Item label="Teslim Adresi" name="delivery_address">
            <Input.TextArea rows={2} />
          </Form.Item>

          <div style={{ display: 'flex', gap: 12 }}>
            <Form.Item label="İlçe" name="delivery_district" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item label="İl" name="delivery_city" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
            <Form.Item label="Posta Kodu" name="delivery_zip" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </div>

          <Form.Item label="Alıcı Adı" name="recipient_name">
            <Input />
          </Form.Item>
          <Form.Item label="Alıcı Telefon" name="recipient_phone">
            <Input />
          </Form.Item>

          <Form.Item label="Planlanan Sevk Tarihi" name="planned_ship_date">
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
          </Form.Item>

          <Form.Item label="Notlar" name="notes">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Divider orientation="left" style={{ fontSize: 13 }}>Ürünler</Divider>
          <Form.List name="items" initialValue={oppItems}>
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name }) => (
                  <Space key={key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                    <Form.Item name={[name, 'product_name']} style={{ marginBottom: 0, flex: 2 }}>
                      <Input placeholder="Ürün adı" style={{ width: 200 }} />
                    </Form.Item>
                    <Form.Item name={[name, 'quantity']} style={{ marginBottom: 0 }}>
                      <InputNumber placeholder="Adet" min={0.01} step={1} style={{ width: 80 }} />
                    </Form.Item>
                    <Form.Item name={[name, 'shelf']} style={{ marginBottom: 0 }}>
                      <Input placeholder="Raf" style={{ width: 80 }} />
                    </Form.Item>
                    <Form.Item name={[name, 'product_id']} hidden><Input /></Form.Item>
                    <Button type="text" danger icon={<DeleteOutlined />} onClick={() => remove(name)} />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ product_name: '', quantity: 1, shelf: '', product_id: null })} icon={<PlusOutlined />} block>
                  Ürün Ekle
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  )
}
