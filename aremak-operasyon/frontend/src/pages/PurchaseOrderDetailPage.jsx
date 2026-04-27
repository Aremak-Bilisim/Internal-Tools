import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Typography, Space, Spin, message, Table, Drawer, Checkbox, InputNumber, Upload, Modal, Alert } from 'antd'
import { ArrowLeftOutlined, ExportOutlined, ReloadOutlined, FilePdfOutlined, CheckSquareOutlined, UploadOutlined, FileExcelOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'

const { Title, Text } = Typography

const STATUS_LABELS = {
  0: { label: 'Talep Edildi', color: 'orange' },
  1: { label: 'Tamamlandı', color: 'green' },
  2: { label: 'İptal', color: 'default' },
}

const STAGE_COLORS = {
  'Üretim Bekliyor': 'blue',
  'Sevk için Hazırlanıyor': 'cyan',
  'Sevk Halinde': 'geekblue',
  'Gümrük İşlemleri Yapılıyor': 'purple',
  'Teslim Alındı': 'green',
}

export default function PurchaseOrderDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [po, setPo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptItems, setReceiptItems] = useState([])  // {tg_product_id, displayname, ordered_qty, received_qty, included, price, currency, vat, unit, description}
  const [excelLoading, setExcelLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = () => {
    setLoading(true)
    api.get(`/purchase-orders/${id}`)
      .then((r) => setPo(r.data))
      .catch((e) => message.error(e?.response?.data?.detail || 'Sipariş yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const openReceiptDrawer = () => {
    setReceiptItems(po.items.map((it) => ({
      tg_product_id: it.tg_product_id,
      displayname: it.displayname || `${it.brand || ''} - ${it.prod_model || ''}`,
      prod_model: it.prod_model,
      ordered_qty: Number(it.quantity) || 0,
      received_qty: Number(it.quantity) || 0,
      included: true,
      price: Number(it.unit_price) || 0,
      currency: it.currency || 'USD',
      vat: it.vat ?? 20,
      unit: it.unit || 'adet',
      description: it.description || null,
    })))
    setReceiptOpen(true)
  }

  const updateReceiptItem = (idx, field, value) => {
    setReceiptItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it))
  }

  const handleExcelUpload = async ({ file }) => {
    setExcelLoading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.post(`/purchase-orders/${id}/parse-receipt-excel`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const excelMap = {}  // model_name (lower) -> qty
      for (const it of r.data.items || []) {
        excelMap[(it.model_name || '').trim().toLowerCase()] = Number(it.quantity) || 0
      }
      // Eşleştir: prod_model'i Excel model_name ile karşılaştır
      let matchCount = 0
      let unmatchedCount = 0
      setReceiptItems((prev) => prev.map((it) => {
        const key = (it.prod_model || '').trim().toLowerCase()
        if (key && excelMap[key] != null) {
          matchCount++
          return { ...it, received_qty: excelMap[key] }
        }
        // Excel'de yoksa → 0
        unmatchedCount++
        return { ...it, received_qty: 0 }
      }))
      message.success(`Excel işlendi: ${matchCount} eşleşti, ${unmatchedCount} bulunamadı (0 yapıldı)`)
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Excel parse edilemedi')
    } finally {
      setExcelLoading(false)
    }
    return false
  }

  const handleConfirm = async () => {
    // Effective received hesapla
    const allFull = receiptItems.every((it) => it.included && it.received_qty === it.ordered_qty)
    const anyReceived = receiptItems.some((it) => it.included && it.received_qty > 0)
    if (!anyReceived) {
      message.warning('En az bir kalem teslim alınmış olmalı')
      return
    }

    setSubmitting(true)
    try {
      const payload = { items: receiptItems }
      const r = await api.post(`/purchase-orders/${id}/confirm-receipt`, payload)
      const data = r.data
      Modal.success({
        title: 'Teslim onayı oluşturuldu',
        content: (
          <div>
            {data.mode === 'full' ? (
              <p>Sipariş tam olarak teslim alındı. Aşama: <strong>Teslim Alındı</strong></p>
            ) : (
              <>
                <p>Parçalı teslim oluşturuldu:</p>
                <ul>
                  <li>Teslim Alınan: <a href={`/purchase-orders/${data.received_purchase_id}`}>#{data.received_purchase_id}</a></li>
                  <li>Kalan (Üretim Bekliyor): <a href={`/purchase-orders/${data.remaining_purchase_id}`}>#{data.remaining_purchase_id}</a></li>
                </ul>
              </>
            )}
          </div>
        ),
        onOk: () => navigate('/purchase-orders'),
      })
      setReceiptOpen(false)
    } catch (e) {
      message.error(e?.response?.data?.detail || 'Teslim onayı başarısız')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  if (!po) return <div>Sipariş bulunamadı</div>

  const status = STATUS_LABELS[po.status]
  const grandTotal = po.items.reduce((s, it) => s + (Number(it.line_total) || 0), 0)
  const totalQty = po.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
  // Para birimi: kalemlerden al (TG'nin sipariş seviyesindeki CurrencyName=TL olabiliyor)
  const itemCurrency = po.items[0]?.currency || po.currency

  const itemColumns = [
    { title: '#', key: 'idx', width: 40, render: (_, __, i) => i + 1 },
    {
      title: 'Ürün', key: 'displayname',
      render: (_, it) => (
        <div>
          <div style={{ fontWeight: 500 }}>{it.displayname || `${it.brand || ''} - ${it.prod_model || ''}`.trim(' -')}</div>
          {it.sku && <div style={{ fontSize: 11, color: '#888' }}>{it.sku}</div>}
          {it.description && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{it.description}</div>}
        </div>
      ),
    },
    { title: 'Adet', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'right',
      render: (v) => v != null ? Number(v).toLocaleString('tr-TR') : '-' },
    { title: 'Birim', dataIndex: 'unit', key: 'unit', width: 70 },
    {
      title: 'Birim Fiyat', dataIndex: 'unit_price', key: 'unit_price', width: 130, align: 'right',
      render: (v, r) => v != null
        ? `${Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.currency || ''}`
        : '-',
    },
    {
      title: 'Tutar', dataIndex: 'line_total', key: 'line_total', width: 140, align: 'right',
      render: (v, r) => v != null
        ? <Text strong>{`${Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.currency || ''}`}</Text>
        : '-',
    },
  ]

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/purchase-orders')} style={{ marginBottom: 16 }}>
        Geri
      </Button>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Ana Bilgiler */}
          <Card
            title={
              <Space>
                <span>{po.name}</span>
                {po.stage_name && <Tag color={STAGE_COLORS[po.stage_name] || 'default'}>{po.stage_name}</Tag>}
                {status && <Tag color={status.color}>{status.label}</Tag>}
              </Space>
            }
            extra={
              <Space>
                {po.document_url && (
                  <Button
                    size="small"
                    icon={<FilePdfOutlined />}
                    href={po.document_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#ff4d4f', borderColor: '#ff4d4f' }}
                  >
                    Proforma PDF
                  </Button>
                )}
                <Button size="small" icon={<ReloadOutlined />} onClick={load}>Yenile</Button>
                <Button size="small" icon={<ExportOutlined />} href={po.tg_url} target="_blank" rel="noreferrer">
                  TG'de Aç
                </Button>
              </Space>
            }
          >
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Tedarikçi">{po.supplier?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="İlgili Kişi">{po.contact?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Sipariş Tarihi">{po.order_date || '-'}</Descriptions.Item>
              <Descriptions.Item label="Para Birimi">{itemCurrency || '-'}</Descriptions.Item>
              <Descriptions.Item label="Oluşturan">{po.owner?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Toplam Tutar (KDV Hariç)">
                <Text strong>
                  {grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {itemCurrency || ''}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Teslimat Adresi" span={2}>{po.delivery_address || '-'}</Descriptions.Item>
              <Descriptions.Item label="Fatura Adresi" span={2}>{po.billing_address || '-'}</Descriptions.Item>
              {po.supplier_address && (
                <Descriptions.Item label="Tedarikçi Adresi" span={2}>{po.supplier_address}</Descriptions.Item>
              )}
              {po.description && (
                <Descriptions.Item label="Açıklama" span={2}>{po.description}</Descriptions.Item>
              )}
            </Descriptions>
          </Card>

          {/* Teslim Onayı butonu — sadece Teslim Alındı olmayanlarda */}
          {po.stage_name !== 'Teslim Alındı' && po.status !== 1 && po.status !== 2 && (
            <Card size="small" style={{ background: '#fafafa' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Text strong>Sipariş henüz tamamlanmadı</Text>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
                    Teslim alındığında onay oluşturun. Eksik teslimde otomatik parçalı sipariş yaratılır.
                  </div>
                </div>
                <Button type="primary" icon={<CheckSquareOutlined />} onClick={openReceiptDrawer}>
                  Teslim Onayı Oluştur
                </Button>
              </div>
            </Card>
          )}

          {/* Ürünler */}
          <Card title={`Ürünler (${po.items.length})`} size="small">
            <Table
              dataSource={po.items}
              columns={itemColumns}
              rowKey={(_, i) => i}
              pagination={false}
              size="small"
              summary={() => (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: '#fafafa' }}>
                    <Table.Summary.Cell index={0} colSpan={2}><Text strong>TOPLAM (KDV Hariç)</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong>{totalQty.toLocaleString('tr-TR')}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} />
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} align="right">
                      <Text strong>
                        {grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {itemCurrency || ''}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </Card>

        </div>

        {/* Sağ sütun: Aşama / Zaman çizelgesi */}
        <div style={{ width: 280 }}>
          <Card title="Süreç" size="small">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="Mevcut Aşama">
                {po.stage_name ? <Tag color={STAGE_COLORS[po.stage_name] || 'default'}>{po.stage_name}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Durum">
                {status ? <Tag color={status.color}>{status.label}</Tag> : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Oluşturulma">
                {po.entered_date ? po.entered_date.slice(0, 10) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Son Güncelleme">
                {po.modified_date ? po.modified_date.slice(0, 16).replace('T', ' ') : '-'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </div>
      </div>

      {/* Teslim Onayı Drawer */}
      <Drawer
        title={`Teslim Onayı — ${po.name}`}
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        width={780}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setReceiptOpen(false)}>İptal</Button>
            <Button type="primary" icon={<CheckSquareOutlined />} loading={submitting} onClick={handleConfirm}>
              Teslim Onayını Oluştur
            </Button>
          </div>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="Excel ile otomatik doldurma"
          description="Hikrobot Commercial Invoice (CI) Excel'ini yükleyince Model name eşleşmelerine göre teslim alınan adetler otomatik doldurulur. Excel'de olmayan kalemler 0 yapılır."
        />

        <Upload
          beforeUpload={(file) => { handleExcelUpload({ file }); return false }}
          showUploadList={false}
          accept=".xlsx,.xls"
        >
          <Button icon={<FileExcelOutlined />} loading={excelLoading} style={{ marginBottom: 16 }}>
            Excel Yükle (CI)
          </Button>
        </Upload>

        <Table
          dataSource={receiptItems}
          rowKey={(_, i) => i}
          pagination={false}
          size="small"
          columns={[
            {
              title: '',
              dataIndex: 'included',
              width: 40,
              render: (v, _, idx) => (
                <Checkbox checked={v} onChange={(e) => updateReceiptItem(idx, 'included', e.target.checked)} />
              ),
            },
            {
              title: 'Ürün',
              dataIndex: 'displayname',
              render: (v, r) => (
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{v}</div>
                  {r.prod_model && <div style={{ fontSize: 11, color: '#888' }}>{r.prod_model}</div>}
                </div>
              ),
            },
            {
              title: 'Sipariş Adedi',
              dataIndex: 'ordered_qty',
              width: 110,
              align: 'right',
              render: (v) => Number(v).toLocaleString('tr-TR'),
            },
            {
              title: 'Teslim Alınan',
              dataIndex: 'received_qty',
              width: 130,
              render: (v, r, idx) => (
                <InputNumber
                  size="small"
                  value={v}
                  min={0}
                  max={r.ordered_qty}
                  step={1}
                  disabled={!r.included}
                  style={{ width: '100%' }}
                  onChange={(val) => updateReceiptItem(idx, 'received_qty', val ?? 0)}
                />
              ),
            },
            {
              title: 'Eksik',
              key: 'missing',
              width: 80,
              align: 'right',
              render: (_, r) => {
                const eff = r.included ? Number(r.received_qty) || 0 : 0
                const missing = (Number(r.ordered_qty) || 0) - eff
                return missing > 0
                  ? <Tag color="orange">{missing}</Tag>
                  : <Tag color="green">✓</Tag>
              },
            },
          ]}
        />

        <div style={{ marginTop: 16, padding: 12, background: '#fafafa', borderRadius: 6 }}>
          {(() => {
            const fully = receiptItems.length > 0 && receiptItems.every((it) => it.included && Number(it.received_qty) === Number(it.ordered_qty))
            const anyReceived = receiptItems.some((it) => it.included && Number(it.received_qty) > 0)
            if (!anyReceived) return <Text type="warning">Hiç kalem teslim alınmamış — onay yapılamaz.</Text>
            if (fully) return <Text type="success" strong>Tam teslim alınacak — bu sipariş Teslim Alındı olarak işaretlenecek.</Text>
            return (
              <Text type="warning" strong>
                Parçalı teslim — 2 yeni sipariş oluşturulacak (Teslim Alındı + Üretim Bekliyor), mevcut sipariş silinecek.
              </Text>
            )
          })()}
        </div>
      </Drawer>
    </div>
  )
}
