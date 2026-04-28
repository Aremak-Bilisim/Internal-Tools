import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  Table, Input, Card, Tag, Typography, Spin, Button, Drawer, Form,
  InputNumber, Select, Row, Col, Space, Divider, Tooltip, Badge,
  Popconfirm, message, Switch, Descriptions, Empty, AutoComplete,
} from 'antd'
import {
  SearchOutlined, PlusOutlined, ReloadOutlined, EditOutlined,
  BoxPlotOutlined, LinkOutlined, CheckCircleOutlined, QuestionCircleOutlined,
  DeleteOutlined, FilePdfOutlined,
} from '@ant-design/icons'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

const BRAND_CODE_MAP = {
  'Hikrobot': 'HIK', 'CST': 'CST', 'Computar': 'COM', 'Arducam': 'ARD',
  'Kowa': 'KOW', 'Tamron': 'TMR', 'TIS': 'TIS', 'VC': 'VC', 'OPT': 'OPT',
}

const PARENT_TYPE_MAP = {
  'Kamera': 'CAM', 'FA Lens': 'LNS', 'Telecentric Lens': 'TCL',
  'Data Kablosu': 'CBL', 'I/O Kablosu': 'IO',
  'Işık': 'LGT', 'Işık Kablosu': 'LGT', 'Işık Kontrolcü': 'LGT',
  'Filtre': 'FLT', 'Lens Aksesuarı': 'LNS',
}

const CAT_SUB_MAP = {
  'Alan Tarama': 'ASC',
  'C': 'C', 'F': 'F', 'M12': 'M12', 'M42': 'M42', 'M72': 'M72',
  '10GigE': '10GIGE', '10GigE Fiber': '10GIGE', '10GigE Flex': '10GIGE', '10GigE SFP+ module': '10GIGE',
  'CXP-12': 'CXP', 'CXP-6': 'CXP',
  'GigE': 'GIGE', 'GigE-Angle': 'GIGE',
  'Flex GigE': 'FLEXGI', 'Flex GigE-Angle': 'FLEXGI',
  'Super Flex GigE': 'SUPERFLEXGI', 'Super Flex USB3.0': 'SUPERFLEXUSB',
  'Flex USB3.0': 'FLEXUSB', 'USB3.0': 'USB30', 'USB2.0': 'USB20', 'USB3.1': 'USB31',
  '12-Pin Power/IO': '12PINPOW', '6-Pin Power/IO': '6PINPOW',
  'Board level IO': 'BOARDLEV', 'Flex 12-Pin Power/IO': 'FLEX12PI',
  'Flex 6-Pin Power/IO': 'FLEX6PIN', 'Super Flex 6-Pin Power/IO': 'SUPERFLE',
  'Ring': 'RING', 'Bar': 'BAR', 'Dome': 'DOME', 'Flat': 'FLAT',
  'Flat (with hole)': 'FLATWITHHOLE', 'Flat-Coaxial': 'FLATCOAXIAL',
  'Coaxial': 'COAXIAL', 'Coaxial-Line-Scan': 'COAXIALLINESCAN',
  'Arch': 'ARCH', 'AOI': 'AOI', 'Spot': 'SPOT', 'Line-Scan': 'LINESCAN',
  'Polarized Ring': 'POLARIZEDRING', 'Shadowless Ring': 'SHADOWLESSRING',
  'Shadowless-Dome': 'SHADOWLESSDOME', 'Shadowless-Flat': 'SHADOWLESSFLAT',
  'Shadowless-Square': 'SHADOWLESSSQUARE',
  'High Brightness-Coaxial': 'HIGHBRIGHTNESSCOAXIAL',
  'High Brightness-Focused Spot': 'HIGHBRIGHTNESSFOCUSEDSPOT',
  'High Brightness-Line-Scan': 'HIGHBRIGHTNESSLINESCAN',
  'High Brightness-Spot': 'HIGHBRIGHTNESSSPOT',
  'Bandpass': 'BP', 'Longpass': 'LP', 'ND': 'ND', 'Polarize': 'PL',
  'IR Pass': 'IR', 'Adaptör': 'ADAPT',
  'Distans Halkası': 'ACC', 'Dönüştürücü': 'ACC',
}

function generateSkuPrefix(brand, parentCatName, childCatName) {
  const brandCode = BRAND_CODE_MAP[brand]
  if (!brandCode || !parentCatName) return null
  const typeCode = PARENT_TYPE_MAP[parentCatName]
  if (!typeCode) return null
  if (parentCatName === 'Işık Kontrolcü') return `ARMK-${brandCode}-${typeCode}-CTL-`
  if (parentCatName === 'Işık Kablosu') return `ARMK-${brandCode}-${typeCode}-MV-`
  const catCode = CAT_SUB_MAP[childCatName]
  if (!catCode) return null
  return `ARMK-${brandCode}-${typeCode}-${catCode}-`
}

const CURRENCY_OPTIONS = [
  { value: 'TL', label: 'TL (₺)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
]

const VAT_OPTIONS = [0, 1, 8, 10, 18, 20]

const CURRENCY_SYMBOL = { TL: '₺', USD: '$', EUR: '€' }

function formatPrice(price, currency) {
  if (price == null) return '-'
  const sym = CURRENCY_SYMBOL[currency] || currency || ''
  return `${price.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${sym}`
}

export default function ProductsPage() {
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [parasutSyncing, setParasutSyncing] = useState(false)
  const [page, setPage] = useState(1)
  const [pagesize] = useState(50)

  // Filters
  const [search, setSearch] = useState('')
  const [parentCatFilter, setParentCatFilter] = useState(null)
  const [catFilter, setCatFilter] = useState(null)
  const [inStockFilter, setInStockFilter] = useState(null)
  const [showPassive, setShowPassive] = useState(false)
  const [parasutOnly, setParasutOnly] = useState(false)
  const searchTimer = useRef(null)

  // Categories & brands
  const [categories, setCategories] = useState({ parents: [], children: [] })
  const [brands, setBrands] = useState([])

  // Pending (sales/warehouse basit form + admin onay)
  const [pendingDrawerOpen, setPendingDrawerOpen] = useState(false)
  const [pendingForm] = Form.useForm()
  const [pendingSubmitting, setPendingSubmitting] = useState(false)
  const [approveDrawerOpen, setApproveDrawerOpen] = useState(false)
  const [approveForm] = Form.useForm()
  const [approveRecord, setApproveRecord] = useState(null)
  const [approveSubmitting, setApproveSubmitting] = useState(false)
  const [approveParentCat, setApproveParentCat] = useState(null)

  // Create drawer
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm] = Form.useForm()
  const [selectedParentCat, setSelectedParentCat] = useState(null)
  const [skuHint, setSkuHint] = useState(null)

  // Edit drawer
  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editForm] = Form.useForm()
  const [editRecord, setEditRecord] = useState(null)
  const [editParentCat, setEditParentCat] = useState(null)

  // Detail drawer
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState(null)
  const [parasutCheck, setParasutCheck] = useState(null)   // null | {loading} | {found, ...}
  const [parasutLoading, setParasutLoading] = useState(false)

  const fetchCategories = useCallback(async () => {
    try {
      const [catRes, brandRes] = await Promise.all([
        api.get('/products/categories'),
        api.get('/products/brands'),
      ])
      setCategories(catRes.data)
      setBrands(brandRes.data)
    } catch {}
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, pagesize })
      if (search) params.set('search', search)
      if (parentCatFilter != null) params.set('parent_category_id', parentCatFilter)
      if (catFilter != null) params.set('category_id', catFilter)
      if (inStockFilter != null) params.set('in_stock', inStockFilter)
      if (showPassive) params.set('not_available', 'true')
      if (parasutOnly) params.set('parasut_only', 'true')
      const r = await api.get(`/products?${params}`)
      setData(r.data)
    } catch (e) {
      message.error('Ürünler yüklenemedi')
    } finally {
      setLoading(false)
    }
  }, [page, pagesize, search, parentCatFilter, catFilter, inStockFilter, showPassive, parasutOnly])

  useEffect(() => { fetchCategories() }, [])
  useEffect(() => { fetchData() }, [fetchData])

  const handleSearch = (val) => {
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setSearch(val)
      setPage(1)
    }, 400)
  }

  const handleSync = async () => {
    setSyncing(true)
    try {
      await api.post('/products/sync')
      message.info('TG senkronizasyonu başlatıldı.')
      setTimeout(() => fetchData(), 5000)
    } catch {
      message.error('Sync başlatılamadı')
    } finally {
      setSyncing(false)
    }
  }

  const handleParasutSync = async () => {
    setParasutSyncing(true)
    try {
      await api.post('/products/sync-parasut')
      message.info('Paraşüt eşleştirme başlatıldı.')
      setTimeout(() => fetchData(), 8000)
    } catch {
      message.error('Paraşüt sync başlatılamadı')
    } finally {
      setParasutSyncing(false)
    }
  }

  // ── Create helpers ────────────────────────────────────────────────────────

  const filteredChildrenForCreate = selectedParentCat
    ? categories.children.filter(c => c.parent_id === selectedParentCat)
    : categories.children

  const updateSkuHint = (brand, parentId, catId) => {
    const parentName = categories.parents.find(p => p.id === parentId)?.name || null
    const childName = categories.children.find(c => c.id === catId)?.name || null
    setSkuHint(generateSkuPrefix(brand, parentName, childName))
  }

  const openCreate = () => {
    createForm.resetFields()
    createForm.setFieldsValue({ currency_name: 'TL', purchase_currency_name: 'TL', vat: 20, unit: 'adet', no_inventory: false, not_available: false })
    setSelectedParentCat(null)
    setSkuHint(null)
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    let values
    try { values = await createForm.validateFields() } catch { return }
    setCreateLoading(true)
    try {
      const payload = {
        brand: values.brand,
        prod_model: values.prod_model,
        sku: values.sku || '',
        price: values.price || null,
        currency_name: values.currency_name,
        purchase_price: values.purchase_price || null,
        purchase_currency_name: values.purchase_currency_name,
        category_id: values.category_id || null,
        unit: values.unit,
        vat: values.vat,
        no_inventory: values.no_inventory || false,
        critical_inventory: values.critical_inventory || 0,
        details: values.details || null,
        not_available: false,
      }
      await api.post('/products', payload)
      message.success('Ürün oluşturuldu')
      setCreateOpen(false)
      fetchData()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Ürün oluşturulamadı')
    } finally {
      setCreateLoading(false)
    }
  }

  // ── Edit helpers ──────────────────────────────────────────────────────────

  const filteredChildrenForEdit = editParentCat
    ? categories.children.filter(c => c.parent_id === editParentCat)
    : categories.children

  const openEdit = (record) => {
    setEditRecord(record)
    // Find parent category
    const child = categories.children.find(c => c.id === record.category_id)
    const parentId = child?.parent_id || record.parent_category_id || null
    setEditParentCat(parentId)
    editForm.setFieldsValue({
      brand: record.brand,
      prod_model: record.prod_model,
      sku: record.sku,
      parent_category_id: parentId,
      category_id: record.category_id,
      price: record.price,
      currency_name: record.currency_name || 'TL',
      purchase_price: record.purchase_price,
      purchase_currency_name: record.purchase_currency_name || 'TL',
      vat: record.vat != null ? Number(record.vat) : 20,
      unit: record.unit || 'adet',
      no_inventory: record.no_inventory,
      critical_inventory: record.critical_inventory,
      details: record.details,
      not_available: record.not_available,
      datasheet_url: record.datasheet_url || '',
    })
    setEditOpen(true)
  }

  const checkParasut = async (record) => {
    setParasutLoading(true)
    setParasutCheck(null)
    try {
      const r = await api.get(`/products/${record.tg_id}/parasut`)
      setParasutCheck(r.data)
      if (r.data.found) {
        // Detay kaydını güncelle (parasut_url artık dolu)
        setDetailRecord(prev => prev ? { ...prev, parasut_id: r.data.parasut_id, parasut_url: r.data.url } : prev)
        fetchData()
      }
    } catch {
      setParasutCheck({ found: false, message: 'Kontrol sırasında hata oluştu' })
    } finally {
      setParasutLoading(false)
    }
  }

  const handleDelete = async (record) => {
    try {
      await api.delete(`/products/${record.tg_id}`)
      message.success('Ürün silindi')
      setEditOpen(false)
      fetchData()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Silme başarısız')
    }
  }

  const submitEdit = async () => {
    let values
    try { values = await editForm.validateFields() } catch { return }
    setEditLoading(true)
    try {
      const payload = {
        brand: values.brand,
        prod_model: values.prod_model,
        sku: values.sku || '',
        price: values.price || null,
        currency_name: values.currency_name,
        purchase_price: values.purchase_price || null,
        purchase_currency_name: values.purchase_currency_name,
        category_id: values.category_id || null,
        unit: values.unit,
        vat: values.vat,
        no_inventory: values.no_inventory || false,
        critical_inventory: values.critical_inventory || 0,
        details: values.details || null,
        not_available: values.not_available || false,
        datasheet_url: values.datasheet_url || null,
      }
      await api.put(`/products/${editRecord.tg_id}`, payload)
      message.success('Ürün güncellendi')
      setEditOpen(false)
      fetchData()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Güncelleme başarısız')
    } finally {
      setEditLoading(false)
    }
  }

  // ── Table columns ─────────────────────────────────────────────────────────

  const columns = [
    {
      title: 'Marka',
      dataIndex: 'brand',
      key: 'brand',
      width: 160,
      render: (v, r) => (
        <Space size={4}>
          <Text strong>{v || '-'}</Text>
          {r.pending_approval && <Tag color="orange" style={{ fontSize: 10, lineHeight: '16px' }}>Onay Bekliyor</Tag>}
        </Space>
      ),
    },
    {
      title: 'Model',
      dataIndex: 'prod_model',
      key: 'prod_model',
      width: 200,
    },
    {
      title: 'Kategori',
      key: 'cat',
      width: 180,
      render: (_, r) => (
        <span>
          {r.parent_category_name && <Text type="secondary" style={{ fontSize: 11 }}>{r.parent_category_name} / </Text>}
          <Text>{r.category_name || '-'}</Text>
        </span>
      ),
    },
    {
      title: 'Stok',
      key: 'inventory',
      width: 80,
      render: (_, r) => {
        if (r.no_inventory) return <Tag>Takipsiz</Tag>
        const v = r.inventory ?? 0
        return <Tag color={v > 0 ? 'green' : 'red'}>{v}</Tag>
      },
    },
    {
      title: 'Raf',
      dataIndex: 'shelf',
      key: 'shelf',
      width: 130,
      render: (v) => v ? <Tag color="geekblue">{v}</Tag> : <span style={{ color: '#bfbfbf' }}>—</span>,
      sorter: (a, b) => (a.shelf || '').localeCompare(b.shelf || '', 'tr'),
    },
    {
      title: 'Satış Fiyatı',
      key: 'price',
      width: 130,
      render: (_, r) => formatPrice(r.price, r.currency_name),
    },
    {
      title: 'Alış Fiyatı',
      key: 'purchase',
      width: 130,
      render: (_, r) => formatPrice(r.purchase_price, r.purchase_currency_name),
    },
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 200,
      render: (v) => <Text code style={{ fontSize: 11 }}>{v || '-'}</Text>,
    },
    {
      title: 'Bağlantı',
      key: 'links',
      width: 90,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4}>
          <Tooltip title="TeamGram'da Aç">
            <a href={r.tg_url} target="_blank" rel="noreferrer">
              <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
            </a>
          </Tooltip>
          <Tooltip title={r.parasut_id ? "Paraşüt'te Aç" : "Paraşüt'te kayıtlı değil"}>
            {r.parasut_id
              ? <a href={r.parasut_url} target="_blank" rel="noreferrer">
                  <CheckCircleOutlined style={{ color: '#1677ff', fontSize: 16 }} />
                </a>
              : <QuestionCircleOutlined style={{ color: '#d9d9d9', fontSize: 16 }} />
            }
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 60,
      fixed: 'right',
      render: (_, r) => (
        <Space>
          <Tooltip title="Detay">
            <Button
              type="text"
              size="small"
              icon={<BoxPlotOutlined />}
              onClick={() => { setDetailRecord(r); setDetailOpen(true); setParasutCheck(null) }}
            />
          </Tooltip>
          <Tooltip title="Düzenle">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openEdit(r)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]

  // ── Filtered children by selected parent ──────────────────────────────────

  const childrenByParent = parentCatFilter
    ? categories.children.filter(c => c.parent_id === parentCatFilter)
    : categories.children

  // ── Pending action card ──
  const pendingItems = (data.items || []).filter((r) => r.pending_approval)

  const openApproveDrawer = (record) => {
    setApproveRecord(record)
    setApproveParentCat(null)
    approveForm.resetFields()
    approveForm.setFieldsValue({
      brand: record.brand,
      prod_model: record.prod_model,
      price: record.price,
      currency_name: record.currency_name || 'USD',
      purchase_price: record.purchase_price,
      purchase_currency_name: record.purchase_currency_name || 'USD',
      vat: record.vat ?? 20,
      unit: record.unit || 'adet',
      details: record.details,
      sku: '',
    })
    setApproveDrawerOpen(true)
  }

  const submitPending = async () => {
    try {
      const values = await pendingForm.validateFields()
      setPendingSubmitting(true)
      await api.post('/products/pending', values)
      message.success('Ürün onay için yöneticiye gönderildi')
      setPendingDrawerOpen(false)
      fetchData()
    } catch (e) {
      if (e?.errorFields) return
      message.error(e?.response?.data?.detail || 'Hata')
    } finally {
      setPendingSubmitting(false)
    }
  }

  const submitApprove = async () => {
    try {
      const values = await approveForm.validateFields()
      setApproveSubmitting(true)
      await api.post(`/products/${approveRecord.id}/approve`, values)
      message.success('Ürün onaylandı ve TG\'ye yazıldı')
      setApproveDrawerOpen(false)
      fetchData()
    } catch (e) {
      if (e?.errorFields) return
      message.error(e?.response?.data?.detail || 'Onaylama başarısız')
    } finally {
      setApproveSubmitting(false)
    }
  }

  const rejectApprove = async () => {
    if (!approveRecord) return
    try {
      await api.post(`/products/${approveRecord.id}/reject`)
      message.warning('Ürün talebi reddedildi')
      setApproveDrawerOpen(false)
      fetchData()
    } catch (e) {
      message.error('Reddedilemedi')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Ürünler</Title>
        <Space>
          <Button icon={<ReloadOutlined />} loading={syncing} onClick={handleSync}>
            TG Sync
          </Button>
          <Button icon={<ReloadOutlined />} loading={parasutSyncing} onClick={handleParasutSync}>
            Paraşüt Sync
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => {
            if (isAdmin) {
              openCreate()
            } else {
              pendingForm.resetFields()
              pendingForm.setFieldsValue({ currency_name: 'USD', purchase_currency_name: 'USD', vat: 20, unit: 'adet' })
              setPendingDrawerOpen(true)
            }
          }}>
            Yeni Ürün
          </Button>
        </Space>
      </div>

      {/* Admin: Onay Bekleyen ürünler aksiyon kartı */}
      {isAdmin && pendingItems.length > 0 && (
        <div style={{
          marginBottom: 16,
          padding: '12px 18px',
          background: '#fffbe6',
          border: '1px solid #ffe58f',
          borderLeft: '4px solid #faad14',
          borderRadius: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Text strong style={{ color: '#d46b08', fontSize: 14 }}>
              ⚡ {pendingItems.length} ürün onayınızı bekliyor
            </Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pendingItems.map((p) => (
              <div key={p.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#fff', borderRadius: 6, padding: '8px 12px',
                border: '1px solid #ffd591',
              }}>
                <Text style={{ fontSize: 13 }}>
                  <Text strong>{p.brand}</Text>
                  <Text> · {p.prod_model}</Text>
                  {p.created_by_name && <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>(Oluşturan: {p.created_by_name})</Text>}
                </Text>
                <Button type="primary" ghost size="small" icon={<CheckCircleOutlined />} onClick={() => openApproveDrawer(p)}>
                  Onayla
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <Card>
        {/* Filters */}
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col flex="220px">
            <Input
              prefix={<SearchOutlined />}
              placeholder="Marka / Model / SKU"
              onChange={e => handleSearch(e.target.value)}
              allowClear
            />
          </Col>
          <Col flex="180px">
            <Select
              placeholder="Ana Kategori"
              style={{ width: '100%' }}
              allowClear
              value={parentCatFilter}
              onChange={v => { setParentCatFilter(v || null); setCatFilter(null); setPage(1) }}
            >
              {categories.parents.map(p => (
                <Option key={p.id} value={p.id}>{p.name}</Option>
              ))}
            </Select>
          </Col>
          <Col flex="180px">
            <Select
              placeholder="Alt Kategori"
              style={{ width: '100%' }}
              allowClear
              value={catFilter}
              onChange={v => { setCatFilter(v || null); setPage(1) }}
            >
              {childrenByParent.map(c => (
                <Option key={c.id} value={c.id}>{c.name}</Option>
              ))}
            </Select>
          </Col>
          <Col flex="150px">
            <Select
              placeholder="Stok Durumu"
              style={{ width: '100%' }}
              allowClear
              value={inStockFilter}
              onChange={v => { setInStockFilter(v ?? null); setPage(1) }}
            >
              <Option value={true}>Stokta Var</Option>
              <Option value={false}>Stokta Yok</Option>
            </Select>
          </Col>
          <Col>
            <Space>
              <Switch checked={showPassive} onChange={v => { setShowPassive(v); setPage(1) }} size="small" />
              <Text style={{ fontSize: 12 }}>Pasif ürünleri göster</Text>
            </Space>
          </Col>
          <Col>
            <Space>
              <Switch checked={parasutOnly} onChange={v => { setParasutOnly(v); setPage(1) }} size="small" />
              <Text style={{ fontSize: 12 }}>Yalnızca Paraşüt'tekileri göster</Text>
            </Space>
          </Col>
        </Row>

        <Table
          dataSource={data.items}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: pagesize,
            total: data.total,
            onChange: (p) => setPage(p),
            showTotal: (t) => `Toplam ${t} ürün`,
            showSizeChanger: false,
          }}
          scroll={{ x: 1220 }}
          size="small"
        />
      </Card>

      {/* ── Create Drawer ── */}
      <Drawer
        title="Yeni Ürün Ekle"
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        width={560}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setCreateOpen(false)}>İptal</Button>
            <Button type="primary" loading={createLoading} onClick={submitCreate}>Kaydet</Button>
          </Space>
        }
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="brand" label="Marka" rules={[{ required: true, message: 'Marka giriniz' }]}>
                <AutoComplete
                  options={brands.map(b => ({ value: b }))}
                  placeholder="Marka seç veya yaz"
                  filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
                  onChange={v => updateSkuHint(v, selectedParentCat, createForm.getFieldValue('category_id'))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="prod_model" label="Model" rules={[{ required: true, message: 'Model giriniz' }]}>
                <Input placeholder="örn: MV-CA020-20GM" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Ana Kategori">
                <Select
                  placeholder="Ana kategori seç"
                  allowClear
                  onChange={v => {
                    setSelectedParentCat(v || null)
                    createForm.setFieldValue('category_id', undefined)
                    setSkuHint(null)
                  }}
                >
                  {categories.parents.map(p => (
                    <Option key={p.id} value={p.id}>{p.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category_id" label="Alt Kategori">
                <Select
                  placeholder="Alt kategori seç"
                  allowClear
                  onChange={v => updateSkuHint(createForm.getFieldValue('brand'), selectedParentCat, v)}
                >
                  {filteredChildrenForCreate.map(c => (
                    <Option key={c.id} value={c.id}>{c.name}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="sku"
            label="SKU"
            extra={skuHint ? (
              <span style={{ fontSize: 12 }}>
                Öneri:{' '}
                <a onClick={() => createForm.setFieldValue('sku', skuHint)}>
                  <Tag color="blue" style={{ cursor: 'pointer', fontFamily: 'monospace' }}>{skuHint}</Tag>
                </a>
                <Text type="secondary" style={{ fontSize: 11 }}>tıkla &amp; model ekle</Text>
              </span>
            ) : null}
          >
            <Input placeholder="ARMK-HIK-CAM-ASC-..." />
          </Form.Item>

          <Divider orientation="left" plain style={{ fontSize: 12 }}>Fiyatlandırma</Divider>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="price" label="Satış Fiyatı">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="currency_name" label="Para Birimi">
                <Select>
                  {CURRENCY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="purchase_price" label="Alış Fiyatı">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="0.00" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="purchase_currency_name" label="Alış Para Birimi">
                <Select>
                  {CURRENCY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain style={{ fontSize: 12 }}>Diğer Bilgiler</Divider>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="vat" label="KDV (%)">
                <Select>
                  {VAT_OPTIONS.map(v => <Option key={v} value={v}>%{v}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="unit" label="Birim">
                <Select>
                  {['adet', 'set', 'kg', 'metre', 'litre', 'kutu', 'paket'].map(u => (
                    <Option key={u} value={u}>{u}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="critical_inventory" label="Kritik Stok">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="no_inventory" label="Stok Takibi" valuePropName="checked">
            <Switch checkedChildren="Takipsiz" unCheckedChildren="Takipli" />
          </Form.Item>

          <Form.Item name="details" label="Açıklama / Detay">
            <TextArea rows={3} placeholder="Ürün açıklaması..." />
          </Form.Item>
        </Form>
      </Drawer>

      {/* ── Edit Drawer ── */}
      <Drawer
        title={editRecord ? `Düzenle: ${editRecord.brand} ${editRecord.prod_model}` : 'Düzenle'}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        width={560}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Popconfirm
              title="Ürünü sil"
              description="Bu ürün TeamGram'dan kalıcı olarak silinecek. Emin misiniz?"
              onConfirm={() => handleDelete(editRecord)}
              okText="Evet, Sil"
              okButtonProps={{ danger: true }}
              cancelText="Vazgeç"
            >
              <Button danger icon={<DeleteOutlined />}>Sil</Button>
            </Popconfirm>
            <Space>
              <Button onClick={() => setEditOpen(false)}>İptal</Button>
              <Button type="primary" loading={editLoading} onClick={submitEdit}>Kaydet</Button>
            </Space>
          </div>
        }
      >
        <Form form={editForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="brand" label="Marka" rules={[{ required: true }]}>
                <AutoComplete
                  options={brands.map(b => ({ value: b }))}
                  filterOption={(input, option) => option.value.toLowerCase().includes(input.toLowerCase())}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="prod_model" label="Model" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="parent_category_id" label="Ana Kategori">
                <Select
                  placeholder="Ana kategori"
                  allowClear
                  onChange={v => {
                    setEditParentCat(v || null)
                    editForm.setFieldValue('category_id', undefined)
                  }}
                >
                  {categories.parents.map(p => <Option key={p.id} value={p.id}>{p.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="category_id" label="Alt Kategori">
                <Select placeholder="Alt kategori" allowClear>
                  {filteredChildrenForEdit.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="sku" label="SKU">
            <Input />
          </Form.Item>

          <Divider orientation="left" plain style={{ fontSize: 12 }}>Fiyatlandırma</Divider>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="price" label="Satış Fiyatı">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="currency_name" label="Para Birimi">
                <Select>
                  {CURRENCY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="purchase_price" label="Alış Fiyatı">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="purchase_currency_name" label="Alış Para Birimi">
                <Select>
                  {CURRENCY_OPTIONS.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Divider orientation="left" plain style={{ fontSize: 12 }}>Diğer Bilgiler</Divider>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="vat" label="KDV (%)">
                <Select>
                  {VAT_OPTIONS.map(v => <Option key={v} value={v}>%{v}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="unit" label="Birim">
                <Select>
                  {['adet', 'set', 'kg', 'metre', 'litre', 'kutu', 'paket'].map(u => (
                    <Option key={u} value={u}>{u}</Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Mevcut Stok">
                {editRecord && (
                  editRecord.no_inventory
                    ? <Tag>Takipsiz</Tag>
                    : <Tag color={editRecord.inventory > 0 ? 'green' : 'red'} style={{ fontSize: 14, padding: '2px 10px' }}>
                        {editRecord.inventory ?? 0}
                      </Tag>
                )}
                <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
                  Stok TG üzerinden yönetilir
                </Text>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="critical_inventory" label="Kritik Stok">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="no_inventory" label="Stok Takibi" valuePropName="checked">
            <Switch checkedChildren="Takipsiz" unCheckedChildren="Takipli" />
          </Form.Item>

          <Form.Item name="details" label="Açıklama / Detay">
            <TextArea rows={3} />
          </Form.Item>

          <Form.Item name="datasheet_url" label="Datasheet URL">
            <Input placeholder="https://..." />
          </Form.Item>

          <Form.Item name="not_available" label="Pasif" valuePropName="checked">
            <Switch checkedChildren="Pasif" unCheckedChildren="Aktif" style={{ background: editForm.getFieldValue('not_available') ? '#ff4d4f' : undefined }} />
          </Form.Item>
        </Form>
      </Drawer>

      {/* ── Detail Drawer ── */}
      <Drawer
        title={detailRecord ? `${detailRecord.brand} ${detailRecord.prod_model}` : 'Ürün Detayı'}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={500}
        extra={
          <Button icon={<EditOutlined />} onClick={() => { setDetailOpen(false); openEdit(detailRecord) }}>
            Düzenle
          </Button>
        }
      >
        {detailRecord && (
          <>
            {/* Dış Linkler */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <Button
                icon={<LinkOutlined />}
                href={detailRecord.tg_url}
                target="_blank"
                size="small"
              >
                TeamGram'da Aç
              </Button>

              {detailRecord.parasut_url ? (
                <Button
                  icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                  href={detailRecord.parasut_url}
                  target="_blank"
                  size="small"
                >
                  Paraşüt'te Aç
                </Button>
              ) : (
                <Button icon={<QuestionCircleOutlined />} size="small" disabled>
                  Paraşüt'te Kayıtlı Değil
                </Button>
              )}
              {detailRecord.datasheet_url && (
                <Button
                  icon={<FilePdfOutlined />}
                  href={detailRecord.datasheet_url}
                  target="_blank"
                  size="small"
                >
                  Datasheet
                </Button>
              )}
            </div>

            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Marka">{detailRecord.brand || '-'}</Descriptions.Item>
              <Descriptions.Item label="Model">{detailRecord.prod_model || '-'}</Descriptions.Item>
              <Descriptions.Item label="SKU">
                <Text code>{detailRecord.sku || '-'}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Kategori">
                {detailRecord.parent_category_name && `${detailRecord.parent_category_name} / `}
                {detailRecord.category_name || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Satış Fiyatı">
                {formatPrice(detailRecord.price, detailRecord.currency_name)}
              </Descriptions.Item>
              <Descriptions.Item label="Alış Fiyatı">
                {formatPrice(detailRecord.purchase_price, detailRecord.purchase_currency_name)}
              </Descriptions.Item>
              <Descriptions.Item label="KDV">{detailRecord.vat != null ? `%${detailRecord.vat}` : '-'}</Descriptions.Item>
              <Descriptions.Item label="Birim">{detailRecord.unit || '-'}</Descriptions.Item>
              <Descriptions.Item label="Stok">
                {detailRecord.no_inventory
                  ? <Tag>Takipsiz</Tag>
                  : <Tag color={detailRecord.inventory > 0 ? 'green' : 'red'}>{detailRecord.inventory ?? 0}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Kritik Stok">{detailRecord.critical_inventory ?? 0}</Descriptions.Item>
              <Descriptions.Item label="Durum">
                {detailRecord.not_available ? <Tag color="red">Pasif</Tag> : <Tag color="green">Aktif</Tag>}
              </Descriptions.Item>
              {detailRecord.details && (
                <Descriptions.Item label="Açıklama">
                  <Text style={{ whiteSpace: 'pre-wrap' }}>{detailRecord.details}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>
          </>
        )}
      </Drawer>

      {/* ── Pending Drawer (Sales/Warehouse) ── */}
      <Drawer
        title="Yeni Ürün Talebi"
        open={pendingDrawerOpen}
        onClose={() => setPendingDrawerOpen(false)}
        width={520}
        footer={
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setPendingDrawerOpen(false)}>İptal</Button>
            <Button type="primary" loading={pendingSubmitting} onClick={submitPending}>
              Onaya Gönder
            </Button>
          </Space>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          Ürün admin onayına gönderilecek. Onaylandığında SKU + kategori atanır ve TG'ye yazılır.
        </Text>
        <Form form={pendingForm} layout="vertical">
          <Form.Item name="brand" label="Marka" rules={[{ required: true }]}>
            <AutoComplete options={brands.map(b => ({ value: b }))} placeholder="Hikrobot, Computar, …" />
          </Form.Item>
          <Form.Item name="prod_model" label="Model" rules={[{ required: true }]}>
            <Input placeholder="MV-CU020-90GM" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item name="price" label="Satış Fiyatı">
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="currency_name" label="Para Birimi">
                <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'TL' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={16}>
              <Form.Item name="purchase_price" label="Alış Fiyatı">
                <InputNumber style={{ width: '100%' }} min={0} step={0.01} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="purchase_currency_name" label="Para Birimi">
                <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'TL' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="vat" label="KDV (%)">
                <InputNumber style={{ width: '100%' }} min={0} max={100} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="unit" label="Birim">
                <Select options={[{ value: 'adet' }, { value: 'set' }, { value: 'metre' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="details" label="Açıklama">
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Drawer>

      {/* ── Approve Drawer (Admin) ── */}
      <Drawer
        title={`Onay: ${approveRecord?.brand || ''} - ${approveRecord?.prod_model || ''}`}
        open={approveDrawerOpen}
        onClose={() => setApproveDrawerOpen(false)}
        width={620}
        footer={
          <Space style={{ float: 'right' }}>
            <Popconfirm title="Bu ürün talebini reddet?" onConfirm={rejectApprove} okText="Reddet" okButtonProps={{ danger: true }} cancelText="Vazgeç">
              <Button danger>Reddet</Button>
            </Popconfirm>
            <Button onClick={() => setApproveDrawerOpen(false)}>Kapat</Button>
            <Button type="primary" loading={approveSubmitting} onClick={submitApprove}>
              Onayla ve TG'ye Yaz
            </Button>
          </Space>
        }
      >
        {approveRecord && (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              Oluşturan: <Text strong>{approveRecord.created_by_name || '-'}</Text>
              · Bu formdaki tüm değerleri düzenleyebilirsiniz. SKU ve kategori onayda atanmalı.
            </Text>
            <Form form={approveForm} layout="vertical">
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="brand" label="Marka" rules={[{ required: true }]}>
                    <AutoComplete options={brands.map(b => ({ value: b }))} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="prod_model" label="Model" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item label="Ana Kategori" required>
                    <Select
                      placeholder="Seç..."
                      value={approveParentCat}
                      onChange={(v) => { setApproveParentCat(v); approveForm.setFieldValue('category_id', undefined) }}
                      options={categories.parents.map(p => ({ value: p.id, label: p.name }))}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="category_id" label="Alt Kategori" rules={[{ required: true }]}>
                    <Select
                      placeholder="Seç..."
                      disabled={!approveParentCat}
                      options={categories.children
                        .filter(c => c.parent_id === approveParentCat)
                        .map(c => ({ value: c.id, label: c.name }))}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="sku" label="SKU" rules={[{ required: true }]}>
                <Input placeholder="ARMK-..." />
              </Form.Item>
              <Row gutter={12}>
                <Col span={16}>
                  <Form.Item name="price" label="Satış Fiyatı">
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} precision={2} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="currency_name" label="Para Birimi">
                    <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'TL' }]} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={16}>
                  <Form.Item name="purchase_price" label="Alış Fiyatı">
                    <InputNumber style={{ width: '100%' }} min={0} step={0.01} precision={2} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="purchase_currency_name" label="Para Birimi">
                    <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'TL' }]} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={12}>
                <Col span={12}>
                  <Form.Item name="vat" label="KDV (%)">
                    <InputNumber style={{ width: '100%' }} min={0} max={100} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="unit" label="Birim">
                    <Select options={[{ value: 'adet' }, { value: 'set' }, { value: 'metre' }]} />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="details" label="Açıklama">
                <TextArea rows={2} />
              </Form.Item>
            </Form>
          </>
        )}
      </Drawer>
    </div>
  )
}
