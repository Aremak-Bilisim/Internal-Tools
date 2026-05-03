import React, { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Card, Table, Tag, Button, Typography, Space, Modal, Form, Input, InputNumber,
  Select, message, Popconfirm, Divider, Tooltip, Spin, Checkbox,
} from 'antd'
import { PlusOutlined, ThunderboltOutlined, ReloadOutlined, DeleteOutlined, ShoppingCartOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

const { Title, Text } = Typography

export default function PurchaseRequestsPage() {
  const navigate = useNavigate()
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [products, setProducts] = useState([])
  const [productLoading, setProductLoading] = useState(false)
  const [addForm] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState({})  // { itemId: { quantity, unit_price } }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/purchase-requests/lists')
      setLists(r.data?.lists || [])
    } catch {
      message.error('Liste yüklenemedi')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const loadProducts = async (search = '') => {
    setProductLoading(true)
    try {
      const params = new URLSearchParams({ pagesize: 50 })
      if (search) params.set('search', search)
      const r = await api.get(`/products?${params}`)
      setProducts(r.data?.items || [])
    } finally { setProductLoading(false) }
  }

  // search input için debounced
  const [productSearchTimer, setProductSearchTimer] = useState(null)
  const onProductSearch = (q) => {
    if (productSearchTimer) clearTimeout(productSearchTimer)
    const t = setTimeout(() => loadProducts(q), 300)
    setProductSearchTimer(t)
  }

  // Tedarikçi seçimi (manuel override)
  const [supplierOptions, setSupplierOptions] = useState([])
  const [supplierLoading, setSupplierLoading] = useState(false)
  const [supplierSearchTimer, setSupplierSearchTimer] = useState(null)
  const searchSuppliers = async (q = '') => {
    setSupplierLoading(true)
    try {
      const r = await api.get(`/purchase-requests/suppliers/search?q=${encodeURIComponent(q)}`)
      setSupplierOptions((r.data?.suppliers || []).map(s => ({ value: s.id, label: s.name + (s.brand_hint ? ` (${s.brand_hint})` : ''), name: s.name })))
    } finally { setSupplierLoading(false) }
  }
  const onSupplierSearch = (q) => {
    if (supplierSearchTimer) clearTimeout(supplierSearchTimer)
    const t = setTimeout(() => searchSuppliers(q), 300)
    setSupplierSearchTimer(t)
  }

  // Yeni tedarikçi yaratma modal'ı
  const [supplierCreateOpen, setSupplierCreateOpen] = useState(false)
  const [newSupplierForm] = Form.useForm()
  const [newSupplierSubmitting, setNewSupplierSubmitting] = useState(false)
  const submitNewSupplier = async () => {
    const v = await newSupplierForm.validateFields()
    setNewSupplierSubmitting(true)
    try {
      const r = await api.post('/purchase-requests/suppliers', v)
      message.success(`Tedarikçi yaratıldı: ${r.data.name} (TG #${r.data.id})`)
      // Yarattığın tedarikçiyi seçili yap
      addForm.setFieldValue('_supplier_id', r.data.id)
      addForm.setFieldValue('_supplier_name', r.data.name)
      setSupplierOptions(prev => [{ value: r.data.id, label: r.data.name, name: r.data.name }, ...prev])
      setSupplierCreateOpen(false)
      newSupplierForm.resetFields()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Tedarikçi oluşturulamadı')
    } finally { setNewSupplierSubmitting(false) }
  }

  const openAddModal = () => {
    addForm.resetFields()
    setAddOpen(true)
    loadProducts()       // ilk açılışta default 50 ürün
    searchSuppliers('')  // ilk açılışta default mapping'teki tedarikçiler
  }

  const submitAdd = async () => {
    const v = await addForm.validateFields()
    setSubmitting(true)
    try {
      const payload = {
        product_id: v.product_id,
        quantity: v.quantity,
        unit_price: v.unit_price,
        notes: v.notes,
      }
      if (v._supplier_id) {
        payload.tg_supplier_id = v._supplier_id
        const sel = supplierOptions.find(s => s.value === v._supplier_id)
        payload.supplier_name = sel?.name || v._supplier_name || null
        payload.save_as_default = !!v._save_as_default
      }
      const r = await api.post('/purchase-requests/items', payload)
      if (r.data?.merged) message.success('Mevcut kaleme eklendi (adet birleşti)')
      else message.success('Eklendi')
      setAddOpen(false)
      load()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Ekleme başarısız')
    } finally { setSubmitting(false) }
  }

  const autoFill = async () => {
    setAutoFilling(true)
    try {
      const r = await api.post('/purchase-requests/auto-fill-critical-stock')
      const d = r.data || {}
      message.success(`Eklendi: ${d.added}, Zaten ekli: ${d.skipped_already}, Tedarikçi tanımsız: ${d.skipped_no_supplier}, Eşik üstü: ${d.skipped_below_threshold}`)
      load()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Auto-fill hatası')
    } finally { setAutoFilling(false) }
  }

  const updateItem = async (itemId, body) => {
    try {
      await api.patch(`/purchase-requests/items/${itemId}`, body)
      load()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Güncelleme başarısız')
    }
  }

  const deleteItem = async (itemId) => {
    try {
      await api.delete(`/purchase-requests/items/${itemId}`)
      message.success('Kalem silindi')
      load()
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Silme başarısız')
    }
  }

  const grandTotal = useMemo(() => lists.reduce((sum, l) => sum + (l.total_value || 0), 0), [lists])
  const grandQty = useMemo(() => lists.reduce((sum, l) => sum + (l.total_quantity || 0), 0), [lists])

  const buildColumns = () => [
    {
      title: 'Marka', dataIndex: 'brand', width: 100,
      render: (v, r) => <>
        <Text>{v}</Text>
        {r.source === 'auto_critical_stock' && (
          <Tag color="orange" style={{ marginLeft: 6, fontSize: 10 }}>SİSTEM</Tag>
        )}
      </>,
    },
    { title: 'Model', dataIndex: 'model', width: 180, render: v => <Text strong>{v || '-'}</Text> },
    { title: 'SKU', dataIndex: 'sku', width: 200, render: v => <Text code style={{ fontSize: 11 }}>{v || '-'}</Text> },
    {
      title: 'Stok', key: 'stock', width: 70, align: 'center',
      render: (_, r) => {
        const p = r._product
        if (!p) return '-'
        return <Tag color={(p.inventory ?? 0) > 0 ? 'green' : 'red'}>{p.inventory ?? 0}</Tag>
      },
    },
    {
      title: 'Kritik', key: 'critical', width: 70, align: 'center',
      render: (_, r) => r._product?.critical_inventory || 0,
    },
    {
      title: 'Tedarikçi Sip.', key: 'incoming', width: 100, align: 'center',
      render: (_, r) => (r.incoming_qty || 0) > 0 ? <Tag color="blue">{r.incoming_qty}</Tag> : '-',
    },
    {
      title: 'Adet', dataIndex: 'quantity', width: 110, align: 'right',
      render: (v, r) => (
        <InputNumber
          size="small" min={0} value={v}
          onChange={(val) => setEditing(s => ({ ...s, [r.id]: { ...s[r.id], quantity: val } }))}
          onBlur={() => {
            const next = editing[r.id]?.quantity
            if (next != null && next !== r.quantity) updateItem(r.id, { quantity: next })
          }}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Alış Fiyatı', dataIndex: 'unit_price', width: 130, align: 'right',
      render: (v, r) => (
        <InputNumber
          size="small" min={0} step={0.01} precision={2} value={v}
          onChange={(val) => setEditing(s => ({ ...s, [r.id]: { ...s[r.id], unit_price: val } }))}
          onBlur={() => {
            const next = editing[r.id]?.unit_price
            if (next != null && next !== r.unit_price) updateItem(r.id, { unit_price: next })
          }}
          addonAfter={<Text style={{ fontSize: 11 }}>{r.currency || 'USD'}</Text>}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Satır Toplam', key: 'line_total', width: 130, align: 'right',
      render: (_, r) => (
        <Text strong>
          {Number(r.line_total || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {r.currency || ''}
        </Text>
      ),
    },
    { title: 'Ekleyen', dataIndex: 'added_by', width: 110, render: v => <Text type="secondary" style={{ fontSize: 12 }}>{v || '-'}</Text> },
    {
      title: '', key: 'action', width: 50, align: 'center',
      render: (_, r) => (
        <Popconfirm title="Kalemi sil?" onConfirm={() => deleteItem(r.id)} okText="Sil" cancelText="İptal">
          <Button danger size="small" type="text" icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    },
  ]

  // Item'ları products map ile zenginleştir (stok/kritik için)
  const productsById = useMemo(() => {
    const m = {}
    for (const p of products) m[p.id] = p
    return m
  }, [products])

  // Stok bilgisini ürün listesinden çekmek için tüm ürünleri yükle
  useEffect(() => { loadProducts() }, [])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Talep Listesi</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Yenile</Button>
          <Button icon={<ThunderboltOutlined />} loading={autoFilling} onClick={autoFill}>
            Kritik Stoktan Otomatik Ekle
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
            Manuel Ürün Ekle
          </Button>
        </Space>
      </div>

      {loading && lists.length === 0 ? <Spin /> : null}

      {lists.length === 0 && !loading && (
        <Card>
          <Text type="secondary">Henüz açık talep listesi yok. "Manuel Ürün Ekle" veya "Kritik Stoktan Otomatik Ekle" ile başlayın.</Text>
        </Card>
      )}

      {lists.map(lst => {
        const enriched = (lst.items || []).map(it => ({ ...it, _product: productsById[it.product_id] }))
        return (
          <Card
            key={lst.id}
            title={
              <Space>
                <Text strong>{lst.supplier_name}</Text>
                <Tag color="blue">{lst.items?.length || 0} kalem</Tag>
                <Tag>Liste #{lst.id}</Tag>
              </Space>
            }
            extra={
              <Space>
                <Text type="secondary">Toplam:</Text>
                <Text strong>{lst.total_quantity} adet</Text>
                <Text strong style={{ color: '#1677ff' }}>
                  {Number(lst.total_value || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  {' '}{enriched[0]?.currency || ''}
                </Text>
                <Button
                  type="primary" size="small" icon={<ShoppingCartOutlined />}
                  disabled={(lst.items?.length || 0) === 0}
                  onClick={() => navigate(`/purchase-orders/new?from_list=${lst.id}`)}
                >
                  Siparişe Dönüştür
                </Button>
              </Space>
            }
            style={{ marginBottom: 16 }}
            size="small"
          >
            <Table
              size="small"
              rowKey="id"
              dataSource={enriched}
              columns={buildColumns()}
              pagination={false}
            />
          </Card>
        )
      })}

      {lists.length > 1 && (
        <Card size="small" style={{ background: '#f5f5f5' }}>
          <div style={{ textAlign: 'right', fontSize: 14 }}>
            <Text strong style={{ marginRight: 24 }}>GENEL TOPLAM:</Text>
            <Text strong>{grandQty} adet</Text>
            <Divider type="vertical" />
            <Text strong style={{ color: '#1677ff' }}>
              {Number(grandTotal).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} (karışık para birimi)
            </Text>
          </div>
        </Card>
      )}

      {/* Manuel Ekle Modal */}
      <Modal
        title="Manuel Ürün Ekle"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={submitAdd}
        confirmLoading={submitting}
        okText="Ekle" cancelText="İptal"
        width={600}
      >
        <Form form={addForm} layout="vertical">
          <Form.Item
            name="product_id" label="Ürün"
            rules={[{ required: true, message: 'Ürün seçin' }]}
          >
            <Select
              showSearch
              placeholder="Ürün ara (en az 2 karakter — marka, model, SKU)..."
              loading={productLoading}
              filterOption={false}
              onSearch={onProductSearch}
              notFoundContent={productLoading ? <Spin size="small" /> : null}
              options={products.map(p => ({
                value: p.id,
                label: `${p.brand || ''} ${p.prod_model || ''} (${p.sku || '-'}) — Stok: ${p.inventory ?? 0}`,
              }))}
            />
          </Form.Item>

          <Form.Item
            label="Tedarikçi (opsiyonel — boş bırakılırsa ürünün varsayılanı veya markasından otomatik)"
            extra={<Button size="small" type="link" onClick={() => setSupplierCreateOpen(true)}>+ Yeni Tedarikçi Yarat</Button>}
          >
            <Form.Item name="_supplier_id" noStyle>
              <Select
                allowClear
                showSearch
                placeholder="Tedarikçi ara veya boş bırak..."
                loading={supplierLoading}
                filterOption={false}
                onSearch={onSupplierSearch}
                options={supplierOptions}
              />
            </Form.Item>
          </Form.Item>
          <Form.Item name="_save_as_default" valuePropName="checked" style={{ marginTop: -8 }}>
            <Checkbox>Bu tedarikçiyi ürünün varsayılanı olarak kaydet (sonraki auto-fill'lerde kullanılır)</Checkbox>
          </Form.Item>
          <Form.Item name="quantity" label="Adet" rules={[{ required: true, message: 'Adet girin' }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="unit_price" label="Alış Fiyatı (opsiyonel — boş bırakılırsa ürünün varsayılanı kullanılır)">
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="notes" label="Not (opsiyonel)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Yeni Tedarikçi Yarat (TG)"
        open={supplierCreateOpen}
        onCancel={() => setSupplierCreateOpen(false)}
        onOk={submitNewSupplier}
        confirmLoading={newSupplierSubmitting}
        okText="Yarat" cancelText="İptal"
        width={500}
      >
        <Form form={newSupplierForm} layout="vertical">
          <Form.Item name="name" label="Şirket Adı" rules={[{ required: true }]}>
            <Input placeholder="örn. IVS Technology" />
          </Form.Item>
          <Form.Item name="tax_no" label="VKN/TCKN">
            <Input />
          </Form.Item>
          <Form.Item name="tax_office" label="Vergi Dairesi">
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Adres">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="city" label="Şehir">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="E-posta">
            <Input type="email" />
          </Form.Item>
          <Form.Item name="phone" label="Telefon">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
