import React, { useEffect, useState, useCallback } from 'react'
import { Table, Card, Tag, Typography, Button, Segmented, Tooltip, message } from 'antd'
import { FilePdfOutlined, ReloadOutlined } from '@ant-design/icons'
import api from '../services/api'

const { Title } = Typography

const STATUS_COLORS = { 0: 'blue', 1: 'green', 2: 'red' }
const STATUS_LABELS = { 0: 'Açık', 1: 'Tamamlandı', 2: 'İptal' }

const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ')

export default function OrdersPage() {
  const [data, setData] = useState({ List: [], OrderCount: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const [invoiceMap, setInvoiceMap] = useState({})      // normalized name → invoice
  const [orderInvoiceMap, setOrderInvoiceMap] = useState({}) // orderId → invoice
  const [pdfLoading, setPdfLoading] = useState({})      // invoiceId → bool
  const pagesize = 50

  // Fetch Paraşüt invoices and build lookup map
  const loadInvoices = useCallback(async () => {
    try {
      const res = await api.get('/parasut/invoices')
      const map = {}
      for (const inv of res.data.invoices) {
        const key = inv.contact_name_normalized
        if (!key) continue
        if (!map[key] || inv.issue_date > map[key].issue_date) {
          map[key] = inv
        }
      }
      setInvoiceMap(map)
    } catch {
      // Paraşüt hatası varsa sessizce geç
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = statusFilter !== 'all' ? `&status=${statusFilter}` : ''
    api.get(`/orders?page=${page}&pagesize=${pagesize}${params}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false))
  }, [page, statusFilter])

  useEffect(() => { loadInvoices() }, [loadInvoices])

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

  // Recompute orderId→invoice mapping whenever orders or invoices change
  useEffect(() => {
    const orders = data.List || []
    if (!orders.length || !Object.keys(invoiceMap).length) { setOrderInvoiceMap({}); return }

    const toTRL = (amount, currency, rates) => {
      if (!currency || currency === 'TRL' || currency === 'TRY') return amount
      return amount * (rates[currency] || 1)
    }

    ;(async () => {
      const result = {}
      const rateCache = {}

      const fetchRates = async (dateStr) => {
        if (rateCache[dateStr]) return rateCache[dateStr]
        try {
          const res = await api.get(`/tcmb/rates/${dateStr}`)
          rateCache[dateStr] = res.data.rates || {}
        } catch { rateCache[dateStr] = {} }
        return rateCache[dateStr]
      }

      for (const [nameKey, invoice] of Object.entries(invoiceMap)) {
        const prefix = nameKey.slice(0, 20)
        const matches = orders.filter((order) => {
          const name = order.RelatedEntity?.Displayname || order.RelatedEntity?.Name || ''
          const key = normalize(name)
          return key === nameKey || key.includes(prefix) || nameKey.includes(key.slice(0, 20))
        })
        if (matches.length === 0) continue
        if (matches.length === 1) { result[matches[0].Id] = invoice; continue }

        // Step 1: date proximity
        const invDate = invoice.issue_date ? new Date(invoice.issue_date) : null
        let candidates = matches
        if (invDate) {
          const diffs = matches.map(o => Math.abs(invDate - new Date(o.OrderDate || '2000-01-01')))
          const minDiff = Math.min(...diffs)
          candidates = matches.filter((_, i) => diffs[i] === minDiff)
        }
        if (candidates.length === 1) { result[candidates[0].Id] = invoice; continue }

        // Step 2: amount proximity with TCMB conversion
        const rates = invoice.issue_date ? await fetchRates(invoice.issue_date) : {}
        const invTRL = toTRL(parseFloat(invoice.gross_total || 0), invoice.currency, rates)
        let best = candidates[0], bestDiff = Infinity
        for (const order of candidates) {
          const orderTRL = toTRL(parseFloat(order.DiscountedTotal || 0), order.CurrencyName, rates)
          const diff = Math.abs(invTRL - orderTRL)
          if (diff < bestDiff) { bestDiff = diff; best = order }
        }
        result[best.Id] = invoice
      }

      setOrderInvoiceMap(result)
    })()
  }, [data.List, invoiceMap])

  const findInvoice = (r) => orderInvoiceMap[r.Id] || null

  const columns = [
    {
      title: 'Sipariş',
      dataIndex: 'Displayname',
      key: 'name',
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
      render: (_, r) => r.RelatedEntity?.Displayname || r.RelatedEntity?.Name || '-',
      width: 220,
    },
    {
      title: 'Durum',
      dataIndex: 'Status',
      key: 'status',
      width: 110,
      render: (v) => <Tag color={STATUS_COLORS[v] || 'default'}>{STATUS_LABELS[v] || v}</Tag>,
    },
    {
      title: 'Aşama',
      dataIndex: 'CustomStageName',
      key: 'stage',
      width: 180,
      render: (v) => v || '-',
    },
    {
      title: 'Tutar (KDV Dahil)',
      key: 'total',
      width: 160,
      render: (_, r) => r.DiscountedTotal
        ? `${Number(r.DiscountedTotal).toLocaleString('tr-TR')} ${r.CurrencyName}`
        : '-',
    },
    {
      title: 'Sipariş Tarihi',
      dataIndex: 'OrderDate',
      key: 'date',
      width: 120,
      render: (v) => v?.slice(0, 10),
    },
    {
      title: 'Fatura Tarihi',
      key: 'invoice_date',
      width: 120,
      render: (_, r) => {
        const inv = findInvoice(r)
        return inv ? inv.issue_date : '-'
      },
    },
    {
      title: 'Fatura',
      key: 'invoice',
      width: 130,
      render: (_, r) => {
        const inv = findInvoice(r)
        if (inv) {
          return (
            <div style={{ display: 'flex', gap: 4 }}>
              <Tooltip title={`${inv.invoice_no} — Paraşüt'te gör`}>
                <Tag
                  color="green"
                  style={{ cursor: 'pointer', margin: 0 }}
                  onClick={() => window.open(inv.url, '_blank')}
                >
                  {inv.invoice_no || 'Var'} ↗
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
        // Fallback to TeamGram HasInvoice flag
        if (r.HasInvoice) {
          return (
            <Tag
              color="orange"
              style={{ cursor: 'pointer' }}
              onClick={async () => {
                const res = await api.get(`/orders/${r.Id}/weblink`)
                window.open(res.data.url, '_blank')
              }}
            >
              Var ↗
            </Tag>
          )
        }
        return <Tag color="default">Yok</Tag>
      },
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Müşteri Siparişleri</Title>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Tooltip title="Paraşüt faturalarını yenile">
            <Button
              icon={<ReloadOutlined />}
              size="small"
              onClick={async () => { await api.post('/parasut/invoices/refresh'); loadInvoices() }}
            />
          </Tooltip>
          <Segmented
            options={[
              { label: 'Tümü', value: 'all' },
              { label: 'Açık', value: 'open' },
              { label: 'Kapanan', value: 'closed' },
            ]}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1) }}
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
            current: page,
            pageSize: pagesize,
            total: data.OrderCount || data.List?.length,
            onChange: (p) => setPage(p),
            showTotal: (t) => `Toplam ${t} sipariş`,
          }}
          scroll={{ x: 1100 }}
          size="middle"
        />
      </Card>
    </div>
  )
}
