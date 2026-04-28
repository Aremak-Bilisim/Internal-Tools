import React, { useEffect, useState } from 'react'
import { Modal, List, Spin, Typography, Tag, Button, Steps, Form, Input, Select, message, Alert, Table } from 'antd'
import api from '../services/api'

const { Text } = Typography

export default function HepsiburadaShipmentModal({ open, onClose, onCreated }) {
  const [step, setStep] = useState(0) // 0: pick invoice, 1: preview/sku-fix, 2: form
  const [pendingList, setPendingList] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [preview, setPreview] = useState(null)
  const [skuOverrides, setSkuOverrides] = useState({})  // {parasut_code: local_product_id}
  const [productOptions, setProductOptions] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    if (open) {
      setStep(0)
      setSelectedInvoice(null)
      setPreview(null)
      setSkuOverrides({})
      form.resetFields()
      loadPending()
    }
  }, [open])

  const loadPending = async () => {
    setLoading(true)
    try {
      const r = await api.get('/hepsiburada/pending-invoices')
      setPendingList(r.data?.invoices || [])
    } catch (e) {
      message.error('Hepsiburada faturaları yüklenemedi')
    } finally { setLoading(false) }
  }

  const pickInvoice = async (inv) => {
    setSelectedInvoice(inv)
    setLoading(true)
    try {
      const r = await api.get(`/hepsiburada/preview/${inv.id}`)
      setPreview(r.data)
      // Eşleşmeyen SKU varsa ürün listesi yükle
      if (!r.data.all_matched) {
        const pr = await api.get('/products?pagesize=200')
        setProductOptions((pr.data?.items || []).map(p => ({
          value: p.id,
          label: `${p.brand || ''} ${p.prod_model || ''} (${p.sku || '-'})`.trim(),
        })))
      }
      setStep(1)
    } catch {
      message.error('Önizleme alınamadı')
    } finally { setLoading(false) }
  }

  const allOverridesSet = preview?.unmatched_skus?.every(sku => !!skuOverrides[sku])

  const handleNext = () => {
    if (step === 1) {
      if (!preview.all_matched && !allOverridesSet) {
        message.error('Tüm eşleşmeyen SKU\'lar için ürün seçin')
        return
      }
      // Form'u contact bilgileriyle doldur
      const c = preview.contact || {}
      form.setFieldsValue({
        delivery_type: 'Kargo',
        cargo_company: 'Yurtiçi Kargo',
        delivery_address: c.address,
        delivery_city: c.city,
        delivery_district: c.district,
        recipient_name: c.name,
        recipient_phone: c.phone,
      })
      setStep(2)
    }
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const r = await api.post('/hepsiburada/create-shipment', {
        invoice_id: selectedInvoice.id,
        ...values,
        sku_overrides: skuOverrides,
      })
      message.success('Sevk talebi oluşturuldu')
      onClose()
      onCreated?.(r.data.shipment_id)
    } catch (e) {
      const detail = e?.response?.data?.detail
      if (detail?.error === 'SKU eşleşmedi') {
        message.error(`SKU eşleşmedi: ${detail.unmatched.join(', ')}`)
      } else {
        message.error(detail || 'Sevk oluşturulamadı')
      }
    } finally { setSubmitting(false) }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Hepsiburada Sevki Oluştur"
      width={780}
      footer={null}
      destroyOnClose
    >
      <Steps current={step} size="small" style={{ marginBottom: 20 }} items={[
        { title: 'Fatura Seç' },
        { title: 'Ürün Eşleştir' },
        { title: 'Sevk Bilgileri' },
      ]} />

      {step === 0 && (
        loading ? <Spin /> : pendingList.length === 0 ? (
          <Alert type="info" message="Bekleyen Hepsiburada faturası yok" />
        ) : (
          <List
            dataSource={pendingList}
            renderItem={(inv) => (
              <List.Item
                actions={[<Button key="s" type="primary" size="small" onClick={() => pickInvoice(inv)}>Seç</Button>]}
              >
                <List.Item.Meta
                  title={inv.description || `Fatura #${inv.invoice_no || inv.id}`}
                  description={
                    <span>
                      <Tag>{inv.issue_date}</Tag>
                      <Text type="secondary">{inv.gross_total} {inv.currency}</Text>
                      {inv.contact_name && <Text type="secondary"> · {inv.contact_name}</Text>}
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        )
      )}

      {step === 1 && preview && (
        <>
          <Alert
            type={preview.all_matched ? 'success' : 'warning'}
            message={preview.all_matched
              ? `Tüm ürünler eşleşti (${preview.matched_count})`
              : `${preview.unmatched_count} ürün için manuel eşleştirme gerekiyor`}
            style={{ marginBottom: 12 }}
          />
          <Table
            size="small"
            pagination={false}
            dataSource={preview.line_items}
            rowKey={(it, i) => `${it.product_code || 'unknown'}-${i}`}
            columns={[
              { title: 'Ürün', dataIndex: 'product_name', ellipsis: true },
              { title: 'SKU', dataIndex: 'product_code', width: 140 },
              { title: 'Adet', dataIndex: 'quantity', width: 70 },
              {
                title: 'TG Ürünü',
                width: 280,
                render: (_, it) => {
                  const code = it.product_code
                  if (!code) return <Tag color="red">SKU yok</Tag>
                  if (preview.unmatched_skus.includes(code)) {
                    return (
                      <Select
                        showSearch optionFilterProp="label"
                        placeholder="Ürün seç..."
                        style={{ width: '100%' }}
                        value={skuOverrides[code]}
                        onChange={(v) => setSkuOverrides(p => ({ ...p, [code]: v }))}
                        options={productOptions}
                      />
                    )
                  }
                  return <Tag color="green">Eşleşti</Tag>
                },
              },
            ]}
          />
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Button onClick={() => setStep(0)} style={{ marginRight: 8 }}>Geri</Button>
            <Button type="primary" onClick={handleNext}>İleri</Button>
          </div>
        </>
      )}

      {step === 2 && (
        <Form form={form} layout="vertical">
          <Form.Item name="recipient_name" label="Alıcı Adı" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="recipient_phone" label="Alıcı Telefonu" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="delivery_address" label="Teslimat Adresi" rules={[{ required: true }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="delivery_city" label="Şehir">
            <Input />
          </Form.Item>
          <Form.Item name="delivery_district" label="İlçe">
            <Input />
          </Form.Item>
          <Form.Item name="cargo_company" label="Kargo Firması" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'Yurtiçi Kargo' }, { value: 'MNG Kargo' }, { value: 'Aras Kargo' },
                { value: 'PTT Kargo' }, { value: 'UPS' }, { value: 'Sürat Kargo' },
              ]}
            />
          </Form.Item>
          <Form.Item name="notes" label="Notlar">
            <Input.TextArea rows={2} />
          </Form.Item>
          <div style={{ textAlign: 'right' }}>
            <Button onClick={() => setStep(1)} style={{ marginRight: 8 }}>Geri</Button>
            <Button type="primary" loading={submitting} onClick={handleSubmit}>Sevk Oluştur</Button>
          </div>
        </Form>
      )}
    </Modal>
  )
}
