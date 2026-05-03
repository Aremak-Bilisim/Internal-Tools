import React, { useState, useEffect } from 'react'
import {
  Card, Upload, Button, Typography, Space, Spin, message, Table, Tag, Input, InputNumber,
  Descriptions, Select, Form, Modal, Alert, DatePicker,
} from 'antd'
import { InboxOutlined, FilePdfOutlined, CheckCircleOutlined, CloseCircleOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../services/api'

const { Title, Text } = Typography
const { Dragger } = Upload

export default function PurchaseOrderNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fromListId = searchParams.get('from_list')
  const [fromList, setFromList] = useState(null)  // backend'den çekilen liste objesi
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(null)   // { supplier, po_no, items, total_*, currency }
  const [items, setItems] = useState([])       // editable items with `match`
  const [pdfFile, setPdfFile] = useState(null) // sipariş oluştururken yüklenecek orijinal PDF
  const [poName, setPoName] = useState('')
  const [orderDate, setOrderDate] = useState(null)  // dayjs
  const [deliveryAddress, setDeliveryAddress] = useState(
    'Mustafa Kemal Mah. Dumlupınar Blv. No: 280G İç Kapı No:1260 Çankaya/Ankara'
  )
  const [submitting, setSubmitting] = useState(false)
  const [searchModal, setSearchModal] = useState(null)  // {index} | null
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)

  // Talep listesinden başlat: ?from_list=N varsa liste'yi çek + items'ı yerleştir
  useEffect(() => {
    if (!fromListId) return
    api.get('/purchase-requests/lists').then(r => {
      const lst = (r.data?.lists || []).find(l => String(l.id) === String(fromListId))
      if (!lst) {
        message.error('Talep listesi bulunamadı veya kapanmış')
        return
      }
      setFromList(lst)
      const popItems = (lst.items || []).map(it => ({
        product_name: `${it.brand || ''} ${it.model || ''}`.trim(),
        match: { id: it.product_id, tg_id: it.product_tg_id, displayname: `${it.brand || ''} ${it.model || ''}`.trim(), sku: it.sku },
        quantity: it.quantity,
        unit_price: it.unit_price,
        description: `${it.brand || ''} ${it.model || ''}`.trim(),
      }))
      setItems(popItems)
      setParsed({
        supplier: lst.supplier_name,
        tg_supplier_id: lst.tg_supplier_id,
        po_no: null,
        currency: popItems[0]?.unit_price ? (lst.items[0]?.currency || 'USD') : 'USD',
        order_date: dayjs().format('YYYY-MM-DD'),
      })
      setPoName(`${lst.supplier_name || 'Tedarikçi'} - Talep Listesi #${lst.id}`)
      setOrderDate(dayjs())
      message.info(`Liste #${lst.id}'den ${popItems.length} kalem yüklendi`)
    }).catch(() => message.error('Liste yüklenemedi'))
  }, [fromListId])

  const beforeUpload = async (file) => {
    setParsing(true)
    setParsed(null)
    setItems([])
    setPdfFile(null)
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
      setOrderDate(data.order_date ? dayjs(data.order_date) : dayjs())
      setPdfFile(file)  // orijinal PDF'i sakla — sipariş yaratıldıktan sonra yüklenecek
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

  const pickMatch = async (matchObj) => {
    if (!searchModal) return
    const idx = searchModal.index
    const pdfName = items[idx]?.product_name
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, match: matchObj } : it))
    setSearchModal(null)

    // Sonraki PDF'lerde otomatik bulunabilsin diye kaydet
    if (pdfName) {
      try {
        await api.post('/purchase-orders/match', {
          pdf_name: pdfName,
          product_id: matchObj.id,
        })
        message.success('Eşleşme kaydedildi (sonraki PDF\'lerde hatırlanacak)', 2)
      } catch {
        // Sessiz fail — UI eşleşmeyi gösterir, sadece kalıcı kayıt başarısız
      }
    }
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
        tg_supplier_id: parsed.tg_supplier_id || null,
        request_list_id: fromListId ? Number(fromListId) : null,
        name: poName,
        po_no: parsed.po_no || null,
        order_date: orderDate ? orderDate.format('YYYY-MM-DD') : null,
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
      const tgPurchaseId = res.data.tg_purchase_id

      // PDF'i de yükle
      let docUploaded = false
      if (tgPurchaseId && pdfFile) {
        try {
          const fd = new FormData()
          fd.append('file', pdfFile)
          await api.post(`/purchase-orders/${tgPurchaseId}/document`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
          docUploaded = true
        } catch {
          message.warning('Sipariş oluşturuldu ama PDF kaydedilemedi')
        }
      }

      Modal.success({
        title: 'Tedarikçi siparişi oluşturuldu',
        content: (
          <div>
            <p>TeamGram'da başarıyla kaydedildi.</p>
            {docUploaded && <p>✓ Proforma PDF lokal olarak saklandı.</p>}
            {res.data.tg_url && (
              <a href={res.data.tg_url} target="_blank" rel="noreferrer">TG'de görüntüle</a>
            )}
          </div>
        ),
        onOk: () => navigate('/purchase-orders'),
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
      title: 'Tutar (USD)', key: 'line_total', width: 110,
      render: (_, it) => {
        const lt = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0)
        return <Text strong>{lt.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
      },
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

      {fromList && (
        <Alert
          type="info" showIcon
          style={{ marginTop: 12 }}
          message={`Talep Listesi #${fromList.id} (${fromList.supplier_name}) — ${fromList.items?.length || 0} kalem yüklendi`}
          description="Sipariş oluşturulduğunda bu liste otomatik olarak kapanır ve yaratılan TG siparişiyle eşleştirilir."
        />
      )}

      {/* Upload (talep listesinden geldiyse PDF opsiyonel) */}
      {!parsed && !fromList && (
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
              <Descriptions.Item label="PDF Toplam Adet">
                {parsed.doc_total_quantity?.toLocaleString('tr-TR') ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="PDF Toplam Tutar">
                {parsed.doc_total_amount != null
                  ? `${parsed.doc_total_amount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${parsed.currency}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Aşama">Üretim Bekliyor</Descriptions.Item>
              <Descriptions.Item label="Durum">Talep Edildi</Descriptions.Item>
            </Descriptions>

            <Form layout="vertical" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <Form.Item label="Sipariş Adı" required style={{ flex: 1 }}>
                  <Input
                    value={poName}
                    onChange={(e) => setPoName(e.target.value)}
                    placeholder="Hikrobot - A2603..."
                  />
                </Form.Item>
                <Form.Item label="Sipariş Tarihi" required style={{ width: 200 }}>
                  <DatePicker
                    value={orderDate}
                    onChange={setOrderDate}
                    format="DD.MM.YYYY"
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </div>
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
            {(() => {
              const calcQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
              const calcAmount = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0)
              const docQty = parsed.doc_total_quantity
              const docAmount = parsed.doc_total_amount
              const qtyMismatch = docQty != null && Math.abs(calcQty - docQty) > 0.001
              const amountMismatch = docAmount != null && Math.abs(calcAmount - docAmount) > 0.01
              const mismatch = qtyMismatch || amountMismatch
              return (
                <>
                  <Table
                    dataSource={items}
                    columns={itemColumns}
                    rowKey={(_, i) => i}
                    pagination={false}
                    size="small"
                    summary={() => (
                      <Table.Summary fixed>
                        <Table.Summary.Row style={{ background: '#fafafa' }}>
                          <Table.Summary.Cell index={0} colSpan={2}>
                            <Text strong>TOPLAM</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2}>
                            <Text strong>{calcQty.toLocaleString('tr-TR')}</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={3} />
                          <Table.Summary.Cell index={4}>
                            <Text strong>
                              {calcAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                            </Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={5} />
                        </Table.Summary.Row>
                      </Table.Summary>
                    )}
                  />

                  {(docQty != null || docAmount != null) && (
                    <Alert
                      style={{ marginTop: 12 }}
                      type={mismatch ? 'error' : 'success'}
                      showIcon
                      message={
                        mismatch
                          ? 'Hesaplanan toplam PDF\'teki TOTAL satırıyla uyuşmuyor — parse hatası olabilir'
                          : 'Hesaplanan toplam PDF\'teki TOTAL ile uyuşuyor'
                      }
                      description={
                        <div style={{ fontSize: 12 }}>
                          <div>
                            <strong>Adet:</strong> hesap {calcQty.toLocaleString('tr-TR')} ↔ PDF {docQty?.toLocaleString('tr-TR') ?? '-'}
                            {qtyMismatch && <Tag color="red" style={{ marginLeft: 8 }}>Fark: {(calcQty - docQty).toFixed(2)}</Tag>}
                          </div>
                          <div>
                            <strong>Tutar:</strong> hesap {calcAmount.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} USD ↔ PDF {docAmount?.toLocaleString('tr-TR', { minimumFractionDigits: 2 }) ?? '-'} USD
                            {amountMismatch && <Tag color="red" style={{ marginLeft: 8 }}>Fark: {(calcAmount - docAmount).toFixed(2)}</Tag>}
                          </div>
                        </div>
                      }
                    />
                  )}
                </>
              )
            })()}
          </Card>

          {/* Aksiyonlar */}
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setParsed(null); setItems([]); setPoName(''); setOrderDate(null) }}>
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
