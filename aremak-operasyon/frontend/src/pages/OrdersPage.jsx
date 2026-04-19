import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Table, Card, Tag, Typography, Button, Segmented, Tooltip, message,
  Drawer, Form, Input, Select, DatePicker, Row, Col, Spin, Upload,
} from 'antd'
import { FilePdfOutlined, ReloadOutlined, SendOutlined, UploadOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import api from '../services/api'

const { Title, Text } = Typography
const { TextArea } = Input

const STATUS_COLORS = { 0: 'blue', 1: 'green', 2: 'red' }
const STATUS_LABELS = { 0: 'Açık', 1: 'Tamamlandı', 2: 'İptal' }

const CARGO_COMPANIES = ['Yurtiçi Kargo', 'MNG Kargo', 'Aras Kargo', 'PTT Kargo', 'DHL', 'FedEx', 'UPS', 'Diğer']

const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * HTML tag ve entity'lerini temizler. <br> → newline, diğer taglar → boşluk.
 */
const stripHtml = (str) => {
  if (!str) return ''
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * TeamGram'dan gelen tek parça adresi 4 parçaya ayırmaya çalışır.
 * Türkçe yaygın format: "Sokak No:X\nİlçe/Şehir" veya "Sokak No:X, İlçe/Şehir 34000"
 */
const parseAddress = (raw) => {
  if (!raw) return { addr_line: '', addr_district: '', addr_city: '', addr_zip: '' }

  // Posta kodunu bul (5 haneli sayı)
  const zipMatch = raw.match(/\b(\d{5})\b/)
  const zip = zipMatch ? zipMatch[1] : ''

  // Satırlara veya virgüle böl
  const lines = raw.split(/\n/).map(l => l.trim()).filter(Boolean)

  // "İlçe/Şehir" kalıbını ara (son satırdan başla)
  let district = '', city = ''
  let districtLineIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].replace(/\b\d{5}\b/, '').trim().match(/^([^/,]+)\/(.+)$/)
    if (m) {
      district = m[1].trim()
      city = m[2].trim()
      districtLineIdx = i
      break
    }
  }

  // Adres satırı: ilçe/şehir satırı çıkarılmış hali, posta kodu temizlenmiş
  const addrLines = lines
    .filter((_, i) => i !== districtLineIdx)
    .map(l => l.replace(/\b\d{5}\b/, '').replace(/,\s*$/, '').trim())
    .filter(Boolean)
  const addrLine = addrLines.join('\n')

  return { addr_line: addrLine || raw, addr_district: district, addr_city: city, addr_zip: zip }
}

export default function OrdersPage() {
  const navigate = useNavigate()
  const [data, setData] = useState({ List: [], OrderCount: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [invoiceMap, setInvoiceMap] = useState({})          // normalized_name → invoice
  const [invoiceTaxMap, setInvoiceTaxMap] = useState({})   // tax_number → invoice
  const [invoiceDescMap, setInvoiceDescMap] = useState({}) // description → invoice
  const [invoicesLoaded, setInvoicesLoaded] = useState(false)
  const [orderInvoiceMap, setOrderInvoiceMap] = useState({})
  const [pdfLoading, setPdfLoading] = useState({})
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerOrder, setDrawerOrder] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [drawerLoading, setDrawerLoading] = useState(false)
  const [paymentFile, setPaymentFile] = useState(null)  // {file, uploading, url}
  const [drawerItems, setDrawerItems] = useState([])
  const [users, setUsers] = useState([])
  const [shipmentOrderIds, setShipmentOrderIds] = useState(new Set())
  const [form] = Form.useForm()
  const teslimSekli = Form.useWatch('delivery_type', form)
  const gonderiTuru = Form.useWatch('shipping_doc_type', form)
  const odemeDurumu = Form.useWatch('odeme_durumu', form)

  useEffect(() => {
    if (teslimSekli === 'Kargo' && !form.getFieldValue('cargo_company')) {
      form.setFieldValue('cargo_company', 'Yurtiçi Kargo')
    }
  }, [teslimSekli, form])
  const [invoiceRefreshing, setInvoiceRefreshing] = useState(false)

  const buildInvoiceMaps = (invoices) => {
    // nameMap & taxMap → { key: [invoice, ...] }  (tüm faturalar, sadece en son değil)
    const nameMap = {}
    const taxMap = {}
    const descMap = {}
    for (const inv of invoices) {
      const nameKey = inv.contact_name_normalized
      if (nameKey) {
        if (!nameMap[nameKey]) nameMap[nameKey] = []
        nameMap[nameKey].push(inv)
      }
      const taxKey = (inv.contact_tax_number || '').trim()
      if (taxKey) {
        if (!taxMap[taxKey]) taxMap[taxKey] = []
        taxMap[taxKey].push(inv)
      }
      const desc = (inv.description || '').trim()
      if (desc) descMap[desc] = inv
    }

    setInvoiceMap(nameMap)
    setInvoiceTaxMap(taxMap)
    setInvoiceDescMap(descMap)
    setInvoicesLoaded(true)
  }

  const loadInvoices = useCallback(async () => {
    try {
      const res = await api.get('/parasut/invoices')
      buildInvoiceMaps(res.data.invoices)
    } catch {}
  }, [])

  const refreshInvoices = async () => {
    setInvoiceRefreshing(true)
    try {
      const res = await api.post('/parasut/invoices/refresh')
      buildInvoiceMaps(res.data.invoices)
      message.success('Faturalar güncellendi')
    } catch {
      message.error('Faturalar yüklenemedi')
    } finally {
      setInvoiceRefreshing(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    const params = statusFilter !== 'all' ? `&status=${statusFilter}` : ''
    api.get(`/orders?page=1&pagesize=200${params}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => { loadInvoices() }, [loadInvoices])

  useEffect(() => {
    api.get('/users').then((r) => setUsers(r.data)).catch(() => {})
  }, [])

  const [shipmentOrderNames, setShipmentOrderNames] = useState(new Set())

  useEffect(() => {
    api.get('/shipments').then((r) => {
      const ids = new Set(r.data.map((s) => s.tg_order_id).filter(Boolean))
      const names = new Set(r.data.map((s) => s.tg_order_name).filter(Boolean))
      setShipmentOrderIds(ids)
      setShipmentOrderNames(names)
    }).catch(() => {})
  }, [])

  const openPdf = async (invoiceId) => {
    setPdfLoading((p) => ({ ...p, [invoiceId]: true }))
    try {
      const res = await api.get(`/parasut/invoices/${invoiceId}/pdf-url`)
      window.open(res.data.url, '_blank')
    } catch {
      message.error('PDF henüz oluşturulmamış veya alınamadı')
    } finally {
      setPdfLoading((p) => ({ ...p, [invoiceId]: false }))
    }
  }

  useEffect(() => {
    const orders = data.List || []
    const hasInvoiceData = Object.keys(invoiceMap).length || Object.keys(invoiceTaxMap).length
    if (!orders.length || !hasInvoiceData) { setOrderInvoiceMap({}); return }

    const toTRL = (amount, currency, rates) => {
      if (!currency || currency === 'TRL' || currency === 'TRY') return parseFloat(amount) || 0
      return (parseFloat(amount) || 0) * (rates[currency] || 1)
    }

    // Tutar benzerlik skoru: 0=mükemmel, 1=tamamen farklı
    // Fatura TRL, sipariş dövizli olabilir → TCMB fatura tarihindeki satış kuru
    const amountScore = (order, inv, rates) => {
      const orderTRL = toTRL(order.DiscountedTotal, order.CurrencyName, rates)
      const invTRL = parseFloat(inv.gross_total || 0)
      if (orderTRL === 0 || invTRL === 0) return 0.5  // tutar yoksa nötr
      return Math.abs(orderTRL - invTRL) / Math.max(orderTRL, invTRL)
    }

    ;(async () => {
      const result = {}
      const usedInvoiceIds = new Set()
      const rateCache = {}

      const fetchRates = async (dateStr) => {
        if (!dateStr) return {}
        if (rateCache[dateStr]) return rateCache[dateStr]
        try {
          const res = await api.get(`/tcmb/rates/${dateStr}`)
          rateCache[dateStr] = res.data.rates || {}
        } catch { rateCache[dateStr] = {} }
        return rateCache[dateStr]
      }

      // 1. Description eşleştirme (kesin, bire-bir)
      for (const order of orders) {
        const displayname = (order.Displayname || '').trim()
        const inv = invoiceDescMap[displayname]
        if (displayname && inv && !usedInvoiceIds.has(inv.id)) {
          result[order.Id] = inv
          usedInvoiceIds.add(inv.id)
        }
      }

      // 2. Vergi no + isim bazlı: tüm (sipariş, fatura) çiftleri için skor hesapla
      //    Her fatura en fazla 1 siparişe atanır (greedy best-match)
      const candidates = []  // { score, orderId, invoice }

      for (const order of orders) {
        if (result[order.Id]) continue

        const taxNo = (order.RelatedEntity?.TaxNo || '').trim()
        const name = order.RelatedEntity?.Displayname || order.RelatedEntity?.Name || ''
        const normName = normalize(name)

        // Aday faturalar: vergi no + isim eşleşenlerin birleşimi
        const seen = new Set()
        const pool = []
        const addInvs = (invs) => {
          for (const inv of (invs || [])) {
            if (!seen.has(inv.id)) { seen.add(inv.id); pool.push(inv) }
          }
        }

        if (taxNo) addInvs(invoiceTaxMap[taxNo])
        for (const [nameKey, invs] of Object.entries(invoiceMap)) {
          const prefix = nameKey.slice(0, 20)
          if (normName === nameKey || (prefix && normName.includes(prefix)) || (normName.slice(0,20) && nameKey.includes(normName.slice(0, 20))))
            addInvs(invs)
        }

        for (const inv of pool) {
          const rates = await fetchRates(inv.issue_date)
          const score = amountScore(order, inv, rates)
          candidates.push({ score, orderId: order.Id, invoice: inv })
        }
      }

      // Skora göre sırala (en iyi = en düşük) ve greedy ata
      // Eşik: %20'den fazla tutar farkı varsa, şirkete ait başka aday yoksa yine de ata;
      //       ama birden fazla aday varsa sadece en iyisini al.
      candidates.sort((a, b) => a.score - b.score)

      for (const { score, orderId, invoice } of candidates) {
        if (result[orderId]) continue          // sipariş zaten eşleşti
        if (usedInvoiceIds.has(invoice.id)) continue  // fatura başka siparişe gitti

        // Şirkete ait başka kullanılmamış fatura var mı? Varsa %20 eşiğini uygula
        const hasOtherCandidates = candidates.some(
          c => c.orderId === orderId && !usedInvoiceIds.has(c.invoice.id) && c.invoice.id !== invoice.id
        )
        if (hasOtherCandidates && score > 0.20) continue  // daha iyi aday olabilir, geç

        result[orderId] = invoice
        usedInvoiceIds.add(invoice.id)
      }

      setOrderInvoiceMap(result)
    })()
  }, [data.List, invoiceMap, invoiceTaxMap, invoiceDescMap])

  const findInvoice = (r) => orderInvoiceMap[r.Id] || null

  const customerFilters = useMemo(() => {
    const names = new Set()
    ;(data.List || []).forEach(r => {
      const n = r.RelatedEntity?.Displayname || r.RelatedEntity?.Name
      if (n) names.add(n)
    })
    return [...names].sort((a, b) => a.localeCompare(b, 'tr')).map(n => ({ text: n, value: n }))
  }, [data.List])

  const stageFilters = useMemo(() => {
    const stages = new Set()
    ;(data.List || []).forEach(r => { if (r.CustomStageName) stages.add(r.CustomStageName) })
    return [...stages].sort((a, b) => a.localeCompare(b, 'tr')).map(s => ({ text: s, value: s }))
  }, [data.List])

  const openShipmentDrawer = async (order) => {
    const customerName = order.RelatedEntity?.Displayname || order.RelatedEntity?.Name || ''
    const gulAtes = users.find((u) => u.role === 'warehouse')
    setDrawerOrder(order)
    setDrawerOpen(true)
    setDrawerLoading(true)
    setDrawerItems([])
    form.resetFields()
    form.setFieldsValue({
      customer_name: customerName,
      assigned_to_id: gulAtes?.id ?? undefined,
      delivery_type: 'Kargo',
      cargo_company: 'Yurtiçi Kargo',
      planned_ship_date: dayjs(),
    })
    try {
      const res = await api.get(`/orders/${order.Id}`)
      const o = res.data
      // Sevkiyat adresi: siparişin DeliveryAddress'i — parseAddress ile
      // il/ilçe/posta kodunu ayrıştırmaya çalış, kullanıcı eksikleri tamamlar
      const addr = parseAddress(stripHtml(o.DeliveryAddress || '').replace(/\r\n/g, '\n').trim())
      setDrawerItems((o.Items || []).map((item) => ({
        product_name: item.Product?.Displayname || item.Title || '',
        quantity: item.Quantity || 0,
        shelf: '',
      })))

      // Parse payment custom fields
      const cfds = o.CustomFieldDatas || []
      const cfById = Object.fromEntries(cfds.map(f => [f.CustomFieldId, f]))

      // 193501: Ödeme Durumu (select: 14858=Ödendi, 14859=Ödenecek)
      const odemeCf = cfById[193501]
      let odemeVal = ''
      try { odemeVal = String(JSON.parse(odemeCf?.Value ?? 'null')?.Id ?? '') } catch { odemeVal = String(odemeCf?.Value ?? '') }
      const odemeLabel = odemeVal === '14858' ? 'Ödendi' : odemeVal === '14859' ? 'Ödenecek' : undefined

      // 193502: Beklenen Ödeme Tarihi (date string)
      const beklenenCf = cfById[193502]
      const beklenenRaw = beklenenCf?.UnFormattedDate || beklenenCf?.Value
      const beklenenVal = beklenenRaw ? dayjs(beklenenRaw) : undefined

      // 193472: Ödeme Belgesi (attachment JSON)
      let odemeBelgesi = null
      try { odemeBelgesi = JSON.parse(cfById[193472]?.Value || 'null') } catch {}

      form.setFieldsValue({
        addr_line: addr.addr_line,
        addr_district: addr.addr_district,
        addr_city: addr.addr_city,
        addr_zip: addr.addr_zip,
        odeme_durumu: odemeLabel,
        beklenen_odeme_tarihi: beklenenVal,
        _odeme_belgesi: odemeBelgesi,
      })
    } catch {}
    finally { setDrawerLoading(false) }
  }

  const submitShipment = async () => {
    try {
      const values = await form.validateFields()
      if (values.odeme_durumu === 'Ödendi') {
        const belgeler = form.getFieldValue('_odeme_belgesi')
        if (!belgeler?.length && !paymentFile?.file) {
          message.error('Ödeme belgesi yüklenmesi zorunludur')
          return
        }
      }
      // İrsaliye seçiliyse fatura zorunlu
      const docType = values.shipping_doc_type || ''
      const inv = findInvoice(drawerOrder)
      if (docType.includes('İrsaliye') && !inv) {
        message.error('Gönderim belgesi İrsaliye seçildi ancak bu siparişe eşleşen Paraşüt faturası bulunamadı. Devam etmek için önce Paraşüt\'te fatura oluşturun ve faturaları yenileyin.')
        return
      }

      console.log('[DEBUG] Form values:', {
        addr_line: values.addr_line,
        addr_district: values.addr_district,
        addr_city: values.addr_city,
        addr_zip: values.addr_zip,
        delivery_type: values.delivery_type,
        shipping_doc_type: values.shipping_doc_type,
      })
      setSubmitting(true)
      const shipmentRes = await api.post('/shipments', {
        tg_order_id: drawerOrder.Id,
        tg_order_name: drawerOrder.Displayname,
        customer_name: values.customer_name,
        delivery_type: values.delivery_type || null,
        cargo_company: values.cargo_company || null,
        delivery_address: values.addr_line || null,
        delivery_district: values.addr_district || null,
        delivery_city: values.addr_city || null,
        delivery_zip: values.addr_zip || null,
        notes: values.notes || null,
        invoice_url: inv?.url || null,
        invoice_no: inv?.invoice_no || null,
        invoice_note: values.invoice_note || null,
        recipient_name: values.recipient_name || null,
        recipient_phone: values.recipient_phone || null,
        planned_ship_date: values.planned_ship_date ? values.planned_ship_date.format('YYYY-MM-DD') : null,
        shipping_doc_type: values.shipping_doc_type || null,
        waybill_note: values.waybill_note || null,
        assigned_to_id: values.assigned_to_id || null,
        items: drawerItems,
      })
      // Upload payment document if provided
      if (paymentFile?.file && values.odeme_durumu === 'Ödendi') {
        setPaymentFile(p => ({ ...p, uploading: true }))
        const fd = new FormData()
        fd.append('file', paymentFile.file)
        try {
          await api.post(`/orders/${drawerOrder.Id}/payment-doc`, fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        } catch {
          message.error('Ödeme belgesi yüklenemedi')
        } finally {
          setPaymentFile(p => ({ ...p, uploading: false }))
        }
      }

      // Update TeamGram custom fields
      const cfUpdates = {}
      if (values.odeme_durumu) {
        cfUpdates['193501'] = values.odeme_durumu === 'Ödendi' ? '14858' : '14859'
      }
      if (values.beklenen_odeme_tarihi) {
        cfUpdates['193502'] = values.beklenen_odeme_tarihi.format('YYYY-MM-DD')
      }
      if (Object.keys(cfUpdates).length) {
        try {
          await api.put(`/orders/${drawerOrder.Id}/custom-fields`, { fields: cfUpdates })
        } catch {}
      }

      setShipmentOrderIds((prev) => new Set([...prev, drawerOrder.Id]))
      const resWarnings = shipmentRes.data.warnings || []
      if (resWarnings.length > 0) {
        resWarnings.forEach(w => message.warning(w, 8))
      } else {
        message.success('Sevk talebi oluşturuldu')
      }
      setDrawerOpen(false)
      form.resetFields()
      navigate(`/shipments/${shipmentRes.data.id}`)
    } catch (err) {
      if (err?.errorFields) return
      message.error('Sevk talebi oluşturulamadı')
    } finally {
      setSubmitting(false)
    }
  }

  const columns = [
    {
      title: 'Sipariş (TeamGram)',
      dataIndex: 'Displayname',
      key: 'name',
      sorter: (a, b) => (a.Displayname || '').localeCompare(b.Displayname || '', 'tr'),
      render: (v, r) => (
        <a
          href="#"
          onClick={async (e) => {
            e.preventDefault()
            const res = await api.get(`/orders/${r.Id}/weblink`)
            window.open(res.data.url, '_blank')
          }}
        >
          {v}
        </a>
      ),
    },
    {
      title: 'Müşteri',
      key: 'customer',
      width: 220,
      filters: customerFilters,
      filterSearch: true,
      onFilter: (value, r) => (r.RelatedEntity?.Displayname || r.RelatedEntity?.Name || '') === value,
      sorter: (a, b) => {
        const na = a.RelatedEntity?.Displayname || a.RelatedEntity?.Name || ''
        const nb = b.RelatedEntity?.Displayname || b.RelatedEntity?.Name || ''
        return na.localeCompare(nb, 'tr')
      },
      render: (_, r) => {
        const name = r.RelatedEntity?.Displayname || r.RelatedEntity?.Name || '-'
        return (
          <div>
            <div>{name}</div>
            {!shipmentOrderIds.has(r.Id) && !shipmentOrderNames.has(r.Displayname) && (
              <button
                className="sevk-btn"
                onClick={(e) => { e.stopPropagation(); openShipmentDrawer(r) }}
              >
                <SendOutlined style={{ fontSize: 10, marginRight: 4 }} />
                Sevk Talebi Oluştur
              </button>
            )}
          </div>
        )
      },
    },
    {
      title: 'Sipariş Durumu',
      dataIndex: 'Status',
      key: 'status',
      width: 110,
      filters: [
        { text: 'Açık', value: 0 },
        { text: 'Tamamlandı', value: 1 },
        { text: 'İptal', value: 2 },
      ],
      onFilter: (value, r) => r.Status === value,
      sorter: (a, b) => (a.Status ?? 99) - (b.Status ?? 99),
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: 'Aşama',
      dataIndex: 'CustomStageName',
      key: 'stage',
      width: 180,
      filters: stageFilters,
      filterSearch: true,
      onFilter: (value, r) => (r.CustomStageName || '') === value,
      sorter: (a, b) => (a.CustomStageName || '').localeCompare(b.CustomStageName || '', 'tr'),
      render: (v) => v || '-',
    },
    {
      title: 'Tutar (KDV Dahil)',
      key: 'total',
      width: 160,
      sorter: (a, b) => parseFloat(a.DiscountedTotal || 0) - parseFloat(b.DiscountedTotal || 0),
      render: (_, r) => r.DiscountedTotal
        ? `${Number(r.DiscountedTotal).toLocaleString('tr-TR')} ${r.CurrencyName}`
        : '-',
    },
    {
      title: 'Sipariş Tarihi',
      dataIndex: 'OrderDate',
      key: 'date',
      width: 120,
      sorter: (a, b) => (a.OrderDate || '').localeCompare(b.OrderDate || ''),
      render: (v) => v?.slice(0, 10),
    },
    {
      title: 'Fatura Tarihi',
      key: 'invoice_date',
      width: 120,
      sorter: (a, b) => {
        const da = findInvoice(a)?.issue_date || ''
        const db = findInvoice(b)?.issue_date || ''
        return da.localeCompare(db)
      },
      render: (_, r) => {
        const inv = findInvoice(r)
        return inv ? inv.issue_date : '-'
      },
    },
    {
      title: 'Fatura (Paraşüt)',
      key: 'invoice',
      width: 130,
      filters: [
        { text: 'Var', value: 'var' },
        { text: 'Yok', value: 'yok' },
      ],
      onFilter: (value, r) => {
        const hasInv = !!(findInvoice(r) || (r.HasInvoice && !invoicesLoaded))
        return value === 'var' ? hasInv : !hasInv
      },
      render: (_, r) => {

        const inv = findInvoice(r)
        if (inv) {
          return (
            <div style={{ display: 'flex', gap: 4 }}>
              <Tooltip title={inv.invoice_no ? `${inv.invoice_no} — Paraşüt'te gör` : 'Paraşüt\'te onay bekleniyor'}>
                <Tag
                  color={inv.invoice_no ? 'green' : 'orange'}
                  style={{ cursor: 'pointer', margin: 0 }}
                  onClick={() => window.open(inv.url, '_blank')}
                >
                  {inv.invoice_no ? inv.invoice_no + ' ↗' : 'Onay Bekleniyor ↗'}
                </Tag>
              </Tooltip>
              <Tooltip title="PDF görüntüle">
                <Button
                  type="text"
                  icon={<FilePdfOutlined />}
                  size="small"
                  loading={pdfLoading[inv.id]}
                  onClick={() => openPdf(inv.id)}
                  style={{ color: '#ff4d4f', padding: '0 2px' }}
                />
              </Tooltip>
            </div>
          )
        }
        if (r.HasInvoice && !invoicesLoaded) {
          return <Tag color="orange">Var ↗</Tag>
        }
        return <Tag color="default">Yok</Tag>
      },
    },
    {
      title: '',
      key: 'detail',
      width: 80,
      render: (_, r) => (
        <Button icon={<EyeOutlined />} size="small" onClick={() => navigate(`/orders/${r.Id}`)}>
          Detay
        </Button>
      ),
    },
  ]

  return (
    <div>
      <style>{`
        .sevk-btn {
          display: inline-flex; align-items: center;
          margin-top: 4px; padding: 2px 8px;
          font-size: 11px; font-weight: 500;
          color: #52c41a; background: transparent;
          border: 1px solid #b7eb8f; border-radius: 10px;
          cursor: pointer; transition: all 0.18s ease;
          opacity: 0.55; transform: scale(0.95);
          line-height: 1.6;
        }
        .ant-table-row:hover .sevk-btn {
          opacity: 1; transform: scale(1.04);
          background: #f6ffed; border-color: #52c41a;
          box-shadow: 0 1px 4px rgba(82,196,26,0.2);
        }
      `}</style>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Müşteri Siparişleri</Title>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Tooltip title="Paraşüt faturalarını yenile">
            <Button
              icon={<ReloadOutlined />}
              size="small"
              loading={invoiceRefreshing}
              onClick={refreshInvoices}
            />
          </Tooltip>
          <Segmented
            options={[
              { label: 'Tümü', value: 'all' },
              { label: 'Açık', value: 'open' },
              { label: 'Kapanan', value: 'closed' },
            ]}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v) }}
          />
        </div>
      </div>
      <Card>
        <Table
          dataSource={data.List}
          columns={columns}
          rowKey="Id"
          loading={loading}
          pagination={{
            pageSize: 50,
            showTotal: (t) => `Toplam ${t} sipariş`,
            showSizeChanger: false,
          }}
          scroll={{ x: 1200 }}
          size="middle"
        />
      </Card>

      <Drawer
        title="Sevk Talebi Oluştur"
        placement="right"
        width={480}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); form.resetFields(); setPaymentFile(null) }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { setDrawerOpen(false); form.resetFields() }}>İptal</Button>
            <Button type="primary" icon={<SendOutlined />} loading={submitting} onClick={submitShipment}>
              Talebi Oluştur
            </Button>
          </div>
        }
      >
        {drawerOrder && (
          <div style={{ marginBottom: 20, padding: '12px 16px', background: '#f5f5f5', borderRadius: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>Sipariş</Text>
            <div style={{ fontWeight: 500 }}>{drawerOrder.Displayname}</div>
            {findInvoice(drawerOrder) && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Fatura </Text>
                <Text style={{ fontSize: 12 }}>{findInvoice(drawerOrder).invoice_no}</Text>
              </div>
            )}
          </div>
        )}

        <Spin spinning={drawerLoading}>
          <Form form={form} layout="vertical">
            <Form.Item
              name="customer_name"
              label="Müşteri"
              rules={[{ required: true, message: 'Müşteri adı gerekli' }]}
            >
              <Input />
            </Form.Item>

            <Form.Item
              name="assigned_to_id"
              label="Sevk Sorumlusu"
              rules={[{ required: true, message: 'Sevk sorumlusu seçin' }]}
            >
              <Select placeholder="Seçin..." options={users.map((u) => ({ value: u.id, label: u.name }))} />
            </Form.Item>

            <Row gutter={12}>
              <Col span={12}>
                <Form.Item
                  name="delivery_type"
                  label="Teslim Şekli"
                  rules={[{ required: true, message: 'Teslim şekli seçin' }]}
                >
                  <Select
                    placeholder="Seçin..."
                    options={[
                      { value: 'Kargo', label: 'Kargo' },
                      { value: 'Ofis Teslim', label: 'Ofis Teslim' },
                    ]}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="planned_ship_date" label="Planlanan Sevk Tarihi" rules={[{ required: true, message: 'Tarih seçin' }]}>
                  <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
                </Form.Item>
              </Col>
            </Row>

            {teslimSekli === 'Kargo' && (
              <>
                <Form.Item
                  name="cargo_company"
                  label="Kargo Firması"
                  rules={[{ required: true, message: 'Kargo firması seçin' }]}
                >
                  <Select placeholder="Seçin..." options={CARGO_COMPANIES.map(c => ({ value: c, label: c }))} />
                </Form.Item>

                <Form.Item
                  name="addr_line"
                  label="Teslimat Adresi (Sokak / Cadde / No / Daire)"
                  rules={[{ required: true, message: 'Adres gerekli' }]}
                >
                  <TextArea rows={2} placeholder="Örn: Atatürk Cad. No:5 Daire:3" />
                </Form.Item>
                <Row gutter={12}>
                  <Col span={12}>
                    <Form.Item
                      name="addr_district"
                      label="İlçe"
                      rules={[{ required: true, message: 'İlçe gerekli' }]}
                    >
                      <Input placeholder="Örn: Kadıköy" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      name="addr_city"
                      label="İl"
                      rules={[{ required: true, message: 'İl gerekli' }]}
                    >
                      <Input placeholder="Örn: İstanbul" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  name="addr_zip"
                  label="Posta Kodu"
                  rules={[
                    { required: true, message: 'Posta kodu gerekli' },
                    { pattern: /^\d{5}$/, message: '5 haneli posta kodu girin' },
                  ]}
                >
                  <Input placeholder="Örn: 34710" maxLength={5} style={{ width: 120 }} />
                </Form.Item>

                <Row gutter={12}>
                  <Col span={14}>
                    <Form.Item name="recipient_name" label="Alıcı Adı" rules={[{ required: true, message: 'Alıcı adı gerekli' }]}>
                      <Input placeholder="Teslim alacak kişi" />
                    </Form.Item>
                  </Col>
                  <Col span={10}>
                    <Form.Item name="recipient_phone" label="Alıcı Telefonu" rules={[{ required: true, message: 'Telefon gerekli' }]}>
                      <Input placeholder="05xx..." />
                    </Form.Item>
                  </Col>
                </Row>
              </>
            )}

            <Form.Item name="shipping_doc_type" label="Gönderim Belgesi" rules={[{ required: true, message: 'Gönderim belgesi seçin' }]}>
              <Select
                placeholder="Seçin..."
                options={[
                  { value: 'Fatura', label: 'Fatura' },
                  { value: 'İrsaliye', label: 'İrsaliye' },
                  { value: 'Fatura + İrsaliye', label: 'Fatura + İrsaliye' },
                ]}
              />
            </Form.Item>

            {(gonderiTuru === 'Fatura' || gonderiTuru === 'Fatura + İrsaliye') && (
              <Form.Item name="invoice_note" label="Fatura Notu">
                <TextArea rows={2} placeholder="Vergi dairesi, açıklama notu vb." />
              </Form.Item>
            )}

            {(gonderiTuru === 'İrsaliye' || gonderiTuru === 'Fatura + İrsaliye') && (
              <Form.Item name="waybill_note" label="İrsaliye Notu">
                <TextArea rows={2} placeholder="İrsaliyeye eklenecek not..." />
              </Form.Item>
            )}

            <Form.Item
              name="odeme_durumu"
              label="Ödeme Durumu"
              tooltip="Lütfen güncel ödeme durumunu girin"
              rules={[{ required: true, message: 'Ödeme durumu gerekli' }]}
            >
              <Select
                placeholder="Güncel durumu seçin..."
                options={[
                  { value: 'Ödendi', label: 'Ödendi' },
                  { value: 'Ödenecek', label: 'Ödenecek' },
                ]}
              />
            </Form.Item>

            {odemeDurumu === 'Ödendi' && (
              <Form.Item label="Ödeme Belgesi" required>
                <Form.Item noStyle shouldUpdate>
                  {() => {
                    const belgeler = form.getFieldValue('_odeme_belgesi')
                    if (belgeler?.length) {
                      return (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {belgeler.map((b, i) => (
                            <a key={i} href={b.Url} target="_blank" rel="noreferrer">
                              <img
                                src={b.Url}
                                alt={b.FileName}
                                style={{ height: 64, borderRadius: 4, border: '1px solid #d9d9d9', cursor: 'pointer' }}
                                onError={e => { e.target.style.display = 'none' }}
                              />
                              <div style={{ fontSize: 11, color: '#1677ff', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.FileName}</div>
                            </a>
                          ))}
                        </div>
                      )
                    }
                    return (
                      <Upload
                        beforeUpload={(file) => { setPaymentFile({ file }); return false }}
                        onRemove={() => setPaymentFile(null)}
                        maxCount={1}
                        accept="image/*,.pdf"
                        fileList={paymentFile?.file ? [{ uid: '1', name: paymentFile.file.name, status: paymentFile.uploading ? 'uploading' : 'done' }] : []}
                      >
                        <Button icon={<UploadOutlined />} size="small">
                          Belge Yükle
                        </Button>
                        <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                          TeamGram'da belge yok
                        </Text>
                      </Upload>
                    )
                  }}
                </Form.Item>
              </Form.Item>
            )}

            {odemeDurumu === 'Ödenecek' && (
              <Form.Item name="beklenen_odeme_tarihi" label="Beklenen Ödeme Tarihi" rules={[{ required: true, message: 'Tarih seçin' }]}>
                <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" />
              </Form.Item>
            )}

            <Form.Item name="notes" label="Ek Notlar">
              <TextArea rows={2} placeholder="İsteğe bağlı..." />
            </Form.Item>
          </Form>
        </Spin>
      </Drawer>
    </div>
  )
}
