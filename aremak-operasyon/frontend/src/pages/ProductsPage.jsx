import React, { useEffect, useState, useCallback, useRef } from 'react'
import {
  Table, Input, Card, Tag, Typography, Spin, Button, Drawer, Form,
  InputNumber, Select, Row, Col, Space, Divider, Tooltip, Badge,
  Popconfirm, message, Switch, Descriptions, Empty,
} from 'antd'
import {
  SearchOutlined, PlusOutlined, ReloadOutlined, EditOutlined,
  BoxPlotOutlined, LinkOutlined, CheckCircleOutlined, QuestionCircleOutlined,
} from '@ant-design/icons'
import api from '../services/api'

const { Title, Text } = Typography
const { Option } = Select
const { TextArea } = Input

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

// SKU oluşturma: ARMK-{BRAND}-{SUBCAT}-{MODEL}
function generateSku(brand, model, categoryName) {
  const clean = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  const b = clean(brand)
  const c = clean(categoryName)
  const m = clean(model)
  if (!b && !m) return ''
  return ['ARMK', b, c, m].filter(Boolean).join('-')
}

export default function ProductsPage() {
  const [data, setData] = useState({ total: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
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

  // Categories
  const [categories, setCategories] = useState({ parents: [], children: [] })

  // Create drawer
  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createForm] = Form.useForm()
  const [selectedParentCat, setSelectedParentCat] = useState(null)
  const [autoSku, setAutoSku] = useState('')

  // Edit drawer
  const [editOpen, setEditOpen] = useState(false)
  const [editLoading, setEditLoading] = useState(false)
  const [editForm] = Form.useForm()
  const [editRecord, setEditRecord] = useState(null)
  const [editParentCat, setEditParentCat] = useState(null)
  const [editAutoSku, setEditAutoSku] = useState('')

  // Detail drawer
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRecord, setDetailRecord] = useState(null)
  const [parasutCheck, setParasutCheck] = useState(null)   // null | {loading} | {found, ...}
  const [parasutLoading, setParasutLoading] = useState(false)

  const fetchCategories = useCallback(async () => {
    try {
      const r = await api.get('/products/categories')
      setCategories(r.data)
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
      message.info('Senkronizasyon başlatıldı, tamamlanınca liste güncellenecek.')
      setTimeout(() => fetchData(), 5000)
    } catch {
      message.error('Sync başlatılamadı')
    } finally {
      setSyncing(false)
    }
  }

  // ── Create helpers ────────────────────────────────────────────────────────

  const filteredChildrenForCreate = selectedParentCat
    ? categories.children.filter(c => c.parent_id === selectedParentCat)
    : categories.children

  const updateAutoSku = (brand, model, catId) => {
    const catName = categories.children.find(c => c.id === catId)?.name || ''
    setAutoSku(generateSku(brand, model, catName))
  }

  const openCreate = () => {
    createForm.resetFields()
    createForm.setFieldsValue({ currency_name: 'TL', purchase_currency_name: 'TL', vat: 20, unit: 'adet', no_inventory: false, not_available: false })
    setSelectedParentCat(null)
    setAutoSku('')
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
        sku: values.sku || autoSku || '',
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

  const updateEditAutoSku = (brand, model, catId) => {
    const catName = categories.children.find(c => c.id === catId)?.name || ''
    setEditAutoSku(generateSku(brand, model, catName))
  }

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
    })
    setEditAutoSku(record.sku || '')
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

  const submitEdit = async () => {
    let values
    try { values = await editForm.validateFields() } catch { return }
    setEditLoading(true)
    try {
      const payload = {
        brand: values.brand,
        prod_model: values.prod_model,
        sku: values.sku || editAutoSku || '',
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
      width: 120,
      render: (v) => <Text strong>{v || '-'}</Text>,
    },
    {
      title: 'Model',
      dataIndex: 'prod_model',
      key: 'prod_model',
      width: 200,
    },
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 200,
      render: (v) => <Text code style={{ fontSize: 11 }}>{v || '-'}</Text>,
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
      title: 'KDV',
      dataIndex: 'vat',
      key: 'vat',
      width: 70,
      render: (v) => v != null ? `%${v}` : '-',
    },
    {
      title: 'Birim',
      dataIndex: 'unit',
      key: 'unit',
      width: 70,
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

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Ürünler</Title>
        <Space>
          <Button icon={<ReloadOutlined />} loading={syncing} onClick={handleSync}>
            TG Sync
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Yeni Ürün
          </Button>
        </Space>
      </div>

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
          rowKey="tg_id"
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
                <Input
                  placeholder="örn: Nikon"
                  onChange={e => {
                    const catId = createForm.getFieldValue('category_id')
                    const model = createForm.getFieldValue('prod_model')
                    updateAutoSku(e.target.value, model, catId)
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="prod_model" label="Model" rules={[{ required: true, message: 'Model giriniz' }]}>
                <Input
                  placeholder="örn: D750"
                  onChange={e => {
                    const catId = createForm.getFieldValue('category_id')
                    const brand = createForm.getFieldValue('brand')
                    updateAutoSku(brand, e.target.value, catId)
                  }}
                />
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
                  onChange={v => {
                    const brand = createForm.getFieldValue('brand')
                    const model = createForm.getFieldValue('prod_model')
                    updateAutoSku(brand, model, v)
                  }}
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
            label={
              <span>
                SKU{autoSku && <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>Otomatik: {autoSku}</Text>}
              </span>
            }
          >
            <Input placeholder={autoSku || 'ARMK-...'} />
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
          <Space style={{ float: 'right' }}>
            <Button onClick={() => setEditOpen(false)}>İptal</Button>
            <Button type="primary" loading={editLoading} onClick={submitEdit}>Kaydet</Button>
          </Space>
        }
      >
        <Form form={editForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="brand" label="Marka" rules={[{ required: true }]}>
                <Input
                  onChange={e => {
                    const catId = editForm.getFieldValue('category_id')
                    const model = editForm.getFieldValue('prod_model')
                    updateEditAutoSku(e.target.value, model, catId)
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="prod_model" label="Model" rules={[{ required: true }]}>
                <Input
                  onChange={e => {
                    const catId = editForm.getFieldValue('category_id')
                    const brand = editForm.getFieldValue('brand')
                    updateEditAutoSku(brand, e.target.value, catId)
                  }}
                />
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
                <Select
                  placeholder="Alt kategori"
                  allowClear
                  onChange={v => {
                    const brand = editForm.getFieldValue('brand')
                    const model = editForm.getFieldValue('prod_model')
                    updateEditAutoSku(brand, model, v)
                  }}
                >
                  {filteredChildrenForEdit.map(c => <Option key={c.id} value={c.id}>{c.name}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="sku"
            label={
              <span>
                SKU{editAutoSku && editAutoSku !== editRecord?.sku && (
                  <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>Otomatik: {editAutoSku}</Text>
                )}
              </span>
            }
          >
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
            <TextArea rows={3} />
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
    </div>
  )
}
