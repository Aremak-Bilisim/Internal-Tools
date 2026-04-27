import React, { useState } from 'react'
import {
  Card, Upload, Button, Typography, Space, Spin, message, Table, Tag, Input, InputNumber,
  Descriptions, Select, Form, Modal, Alert,
} from 'antd'
import { InboxOutlined, FilePdfOutlined, CheckCircleOutlined, CloseCircleOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import api from '../services/api'

const { Title, Text } = Typography
const { Dragger } = Upload

export default function PurchaseOrderNewPage() {
  const navigate = useNavigate()
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(null)   // { supplier, po_no, items, total_*, currency }
  const [items, setItems] = useState([])       // editable items with `match`
  const [poName, setPoName] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState(
    'Mustafa Kemal Mah. Dumlupınar Blv. No: 280G İç Kapı No:1260 Çankaya/Ankara'
  )
  const [submitting, setSubmitting] = useState(false)
  const [searchModal, setSearchModal] = useState(null)  // {index} | null
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)

  const beforeUpload = async (file) => {
    setParsing(true)
    setParsed(null)
    setItems([])
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await api.post('/purchase-orders/parse-pdf', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const data = res.data
      setParsed(data)
      setItems(data.items || [])
      setPoName(`Hikrobot - ${data.po_no || file.name}`)
      message.success(`PDF parse edildi (${data.items?.length || 0} ürün)`)
    } catch (e) {
      message.error(e?.response?.data?.detail || 'PDF parse edilemedi')
    } finally {
      setParsing(false)
    }
    return false  // dosyayı otomatik gönderme
  }

  const openSearch = (index) => {
    setSearchModal({ index })
    setSearchQ(items[index]?.product_name || '')
    setSearchResults([])
  }

  const doSearch = async (q) => {
    if (!q?.trim()) return
    setSearchLoading(true)
    try {
      const res = await api.get('/purchase-orders/products/search', { params: { q } })
      setSearchResults(res.data || [])
    } catch (e) {
      message.error('Arama başarısız')
    } finally {
      setSearchLoading(false)
    }
  }

  const pickMatch = (matchObj) => {
    if (!searchModal) return
    const idx = searchModal.index
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, match: matchObj } : it))
    setSearchModal(null)
  }

  const clearMatch = (idx) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, match: null } : it))
  }

  const updateItemField = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const allMatched = items.length > 0 && items.every((it) => it.match)

  const handleSubmit = async () => {
    if (!allMatched) {
      message.warning('Tüm ürünler eşleştirilmeli')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        supplier: parsed.supplier || 'Hikrobot',
        name: poName,
        po_no: parsed.po_no || null,
        delivery_address: deliveryAddress,
        billing_address: deliveryAddress,
        currency: parsed.currency || 'USD',
        items: items.map((it) => ({
          product_id: it.match.id,
          tg_product_id: it.match.tg_id,
          product_name: it.match.displayname,
          description: it.description || it.product_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          vat: 20.0,
          unit: 'adet',
        })),
      }
      const res = await api.post('/purchase-orders/create', payload)
      Modal.success({
        title: 'Tedarikçi siparişi oluşturuldu',
        content: (
          <div>
            <p>TeamGram'da başarıyla kaydedildi.</p>
            {res.data.tg_url && (
              <a href={res.data.tg_url} target="_blank" rel="noreferrer">TG'de görüntüle</a>
            )}
          </div>
        ),
        onOk: () => navigate('/'),
      })
    } catch (e) {
      message.error(e?.response?.data?.detail || 'TG kaydı başarısız')
    } finally {
      setSubmitting(false)
    }
  }

  const itemColumns = [
    { title: '#', dataIndex: 'item_no', key: 'item_no', width: 50 },
    {
      title: 'PDF Ürün Adı', key: 'product_name', width: 240,
      render: (_, it) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{it.product_name}</div>
          {it.description && <div style={{ fontSize: 11, color: '#888' }}>{it.description}</div>}
        </div>
      ),
    },
    {
      title: 'Adet', dataIndex: 'quantity', key: 'quantity', width: 80,
      render: (v, _, idx) => (
        <Input
          size="small"
          type="number"
          value={v}
          style={{ width: 70 }}
          onChange={(e) => updateItemField(idx, 'quantity', parseFloat(e.target.value) || 0)}
        />
      ),
    },
    {
      title: 'Birim Fiyat (USD)', dataIndex: 'unit_price', key: 'unit_price', width: 130,
      render: (v, _, idx) => (
        <InputNumber
          size="small"
          value={v}
          style={{ width: 110 }}
          precision={2}
          step={0.01}
          min={0}
          onChange={(val) => updateItemField(idx, 'unit_price', val ?? 0)}
        />
      ),
    },
    {
      title: 'TG Eşleşme', key: 'match', width: 280,
      render: (_, it, idx) => (
        it.match ? (
          <Space>
            <Tag icon={<CheckCircleOutlined />} color="green" style={{ fontSize: 12 }}>
              {it.match.displayname || `${it.match.brand} - ${it.match.prod_model}`}
            </Tag>
            <Button size="small" type="link" onClick={() => clearMatch(idx)}>Değiştir</Button>
          </Space>
        ) : (
          <Space>
            <Tag icon={<CloseCircleOutlined />} color="red">Eşleşme yok</Tag>
            <Button size="small" icon={<SearchOutlined />} onClick={() => openSearch(idx)}>Ara</Button>
          </Space>
        )
      ),
    },
  ]

  return (
    <div>
      <Title level={4}>Tedarikçi Siparişi Oluştur</Title>
      <Text type="secondary">Hikrobot Proforma Invoice PDF'ini yükleyin. Sistem ürünleri eşleştirsin.</Text>

      {/* Upload */}
      {!parsed && (
        <Card style={{ marginTop: 16 }}>
          <Spin spinning={parsing} tip="PDF parse ediliyor...">
            <Dragger
              beforeUpload={beforeUpload}
              showUploadList={false}
              accept=".pdf"
              multiple={false}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">PDF'i sürükleyip bırakın veya tıklayın</p>
              <p className="ant-upload-hint">Sadece Hikrobot Proforma Invoice destekleniyor</p>
            </Dragger>
          </Spin>
        </Card>
      )}

      {/* Parse Sonrası */}
      {parsed && (
        <>
          {/* Tedarikçi tespiti */}
          {parsed.supplier !== 'Hikrobot' && (
            <Alert
              type="error"
              showIcon
              message="Bu PDF Hikrobot proforma invoice'u değil"
              description="Şimdilik sadece Hikrobot tedarikçisi destekleniyor."
              style={{ marginTop: 16 }}
            />
          )}

          <Card title="Sipariş Bilgileri" size="small" style={{ marginTop: 16 }}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Tedarikçi">
                <Tag color="green" icon={<CheckCircleOutlined />}>
                  {parsed.supplier === 'Hikrobot' ? 'Hangzhou Hikrobot Intelligent Co., Ltd.' : parsed.supplier || 'Bilinmiyor'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="İlgili Kişi">Sun Zhiping</Descriptions.Item>
              <Descriptions.Item label="PO No">{parsed.po_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="Para Birimi">{parsed.currency}</Descriptions.Item>
              <Descriptions.Item label="Toplam Adet">{parsed.total_quantity}</Descriptions.Item>
              <Descriptions.Item label="Toplam Tutar">
                {parsed.total_amount?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {parsed.currency}
              </Descriptions.Item>
              <Descriptions.Item label="Aşama">Üretim Bekliyor</Descriptions.Item>
              <Descriptions.Item label="Durum">Talep Edildi</Descriptions.Item>
            </Descriptions>

            <Form layout="vertical" style={{ marginTop: 16 }}>
              <Form.Item label="Sipariş Adı" required>
                <Input
                  value={poName}
                  onChange={(e) => setPoName(e.target.value)}
                  placeholder="Hikrobot - A2603..."
                />
              </Form.Item>
              <Form.Item label="Teslimat ve Fatura Adresi">
                <Input.TextArea
                  rows={2}
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                />
              </Form.Item>
            </Form>
          </Card>

          {/* Ürünler */}
          <Card
            title={`Ürünler (${items.length})`}
            size="small"
            style={{ marginTop: 16 }}
            extra={
              !allMatched && (
                <Tag color="orange">{items.filter(i => !i.match).length} eşleşmeyen ürün var</Tag>
              )
            }
          >
            <Table
              dataSource={items}
              columns={itemColumns}
              rowKey={(_, i) => i}
              pagination={false}
              size="small"
            />
          </Card>

          {/* Aksiyonlar */}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setParsed(null); setItems([]); setPoName('') }}>
              Yeniden Yükle
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={submitting}
              disabled={!allMatched || !poName.trim() || parsed.supplier !== 'Hikrobot'}
              onClick={handleSubmit}
            >
              TG'de Tedarikçi Siparişi Oluştur
            </Button>
          </div>
        </>
      )}

      {/* Manuel Arama Modal */}
      <Modal
        title="TG Ürün Ara"
        open={!!searchModal}
        onCancel={() => setSearchModal(null)}
        footer={null}
        width={600}
      >
        <Input.Search
          placeholder="Marka, model veya SKU..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onSearch={doSearch}
          enterButton
          autoFocus
          loading={searchLoading}
        />
        <div style={{ marginTop: 12, maxHeight: 400, overflowY: 'auto' }}>
          {searchResults.length === 0 && !searchLoading && (
            <Text type="secondary">Sonuç yok. Arama yapın.</Text>
          )}
          {searchResults.map((r) => (
            <div
              key={r.id}
              onClick={() => pickMatch(r)}
              style={{
                padding: 10, border: '1px solid #f0f0f0', borderRadius: 6,
                marginBottom: 6, cursor: 'pointer',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
            >
              <div style={{ fontWeight: 500 }}>{r.displayname}</div>
              <div style={{ fontSize: 11, color: '#888' }}>{r.sku}</div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  )
}
