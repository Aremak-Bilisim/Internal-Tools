import React, { useEffect, useMemo, useState } from 'react'
import { Card, Table, Tag, Button, Typography, Space, Spin, message, DatePicker, Select } from 'antd'
import { PlusOutlined, ReloadOutlined, ExportOutlined, EyeOutlined, FilePdfOutlined, FileExcelOutlined, ClearOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import api from '../services/api'

const { Title } = Typography
const { RangePicker } = DatePicker

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

export default function PurchaseOrdersListPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState(null)        // [dayjs, dayjs] | null
  const [supplierFilter, setSupplierFilter] = useState([])  // string[]

  const load = () => {
    setLoading(true)
    api.get('/purchase-orders/list')
      .then((r) => setItems(r.data.items || []))
      .catch(() => message.error('Liste yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Tüm tedarikçileri unique olarak çıkar (root + child'lar dahil)
  const supplierOptions = useMemo(() => {
    const set = new Set()
    const walk = (rows) => {
      for (const r of rows) {
        if (r.supplier) set.add(r.supplier)
        if (r.children) walk(r.children)
      }
    }
    walk(items)
    return Array.from(set).sort().map((s) => ({ value: s, label: s }))
  }, [items])

  // Filtreleme — root seviyede + child'larıyla beraber filtrele
  const filteredItems = useMemo(() => {
    const fromDate = dateRange?.[0]?.format('YYYY-MM-DD')
    const toDate = dateRange?.[1]?.format('YYYY-MM-DD')
    const supSet = supplierFilter.length ? new Set(supplierFilter) : null

    const matches = (row) => {
      if (supSet && !supSet.has(row.supplier)) return false
      if (fromDate && (!row.order_date || row.order_date < fromDate)) return false
      if (toDate && (!row.order_date || row.order_date > toDate)) return false
      return true
    }

    return items.filter((row) => {
      // Root match → o ve children
      if (matches(row)) return true
      // Children match → root'u da göster
      if (row.children && row.children.some(matches)) return true
      return false
    })
  }, [items, dateRange, supplierFilter])

  const clearFilters = () => {
    setDateRange(null)
    setSupplierFilter([])
  }

  const columns = [
    {
      title: 'Sipariş Adı', dataIndex: 'name', key: 'name',
      render: (v, r) => (
        <Space size={6}>
          {r.parent_id && <span style={{ color: '#bfbfbf', fontSize: 14, marginRight: 4 }}>└</span>}
          <a onClick={() => navigate(r.is_archive ? `/purchase-orders/archive/${r.archive_id}` : `/purchase-orders/${r.id}`)} style={{ cursor: 'pointer' }}>
            {v || '-'}
          </a>
          {r.is_split && <Tag color="purple" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>BÖLÜNDÜ</Tag>}
          {r.is_archive && <Tag color="blue" style={{ fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>ARŞİV</Tag>}
        </Space>
      ),
    },
    { title: 'Tedarikçi', dataIndex: 'supplier', key: 'supplier' },
    {
      title: 'Sipariş Tarihi', dataIndex: 'order_date', key: 'order_date', width: 130,
      render: (v) => v || '-',
      sorter: (a, b) => (a.order_date || '').localeCompare(b.order_date || ''),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Teslim Tarihi', dataIndex: 'delivery_date', key: 'delivery_date', width: 130,
      render: (v) => v
        ? <span style={{ color: '#52c41a' }}>{v}</span>
        : <span style={{ color: '#bfbfbf' }}>—</span>,
    },
    {
      title: 'Aşama', dataIndex: 'stage_name', key: 'stage_name', width: 200,
      render: (v) => v ? <Tag color={STAGE_COLORS[v] || 'default'}>{v}</Tag> : '-',
    },
    {
      title: 'Durum', dataIndex: 'status', key: 'status', width: 120,
      render: (v) => {
        const s = STATUS_LABELS[v]
        return s ? <Tag color={s.color}>{s.label}</Tag> : '-'
      },
    },
    {
      title: 'Belgeler', key: 'documents', width: 100, align: 'center',
      render: (_, r) => (
        <Space size={4}>
          {r.document_url
            ? <a href={r.document_url} target="_blank" rel="noreferrer" title={r.document_name || 'Proforma PDF'}>
                <FilePdfOutlined style={{ fontSize: 18, color: '#ff4d4f' }} />
              </a>
            : <FilePdfOutlined style={{ fontSize: 18, color: '#e0e0e0' }} title="Proforma yok" />}
          {r.receipt_url
            ? <a href={r.receipt_url} target="_blank" rel="noreferrer" title={r.receipt_name || 'Teslim CI'}>
                <FileExcelOutlined style={{ fontSize: 18, color: '#52c41a' }} />
              </a>
            : <FileExcelOutlined style={{ fontSize: 18, color: '#e0e0e0' }} title="Teslim CI yok" />}
        </Space>
      ),
    },
    {
      title: 'Toplam Tutar (KDV Hariç)', dataIndex: 'total', key: 'total', width: 180, align: 'right',
      render: (v, r) => v != null
        ? `${Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${r.currency || ''}`
        : '-',
      sorter: (a, b) => (a.total || 0) - (b.total || 0),
    },
    {
      title: '', key: 'actions', width: 200,
      render: (_, r) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(r.is_archive ? `/purchase-orders/archive/${r.archive_id}` : `/purchase-orders/${r.id}`)}>
            Detay
          </Button>
          {r.tg_url && (
            <Button size="small" icon={<ExportOutlined />} href={r.tg_url} target="_blank" rel="noreferrer">
              TG
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const hasFilter = (dateRange && dateRange.length === 2) || supplierFilter.length > 0

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>Tedarikçi Siparişleri</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Yenile</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/purchase-orders/new')}>
            Yeni Sipariş Oluştur
          </Button>
        </Space>
      </div>

      {/* Filtreler */}
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <span style={{ fontSize: 13, color: '#666' }}>Sipariş tarihi:</span>
          <RangePicker
            value={dateRange}
            onChange={setDateRange}
            format="DD.MM.YYYY"
            allowClear
            placeholder={['Başlangıç', 'Bitiş']}
          />
          <span style={{ fontSize: 13, color: '#666', marginLeft: 12 }}>Tedarikçi:</span>
          <Select
            mode="multiple"
            value={supplierFilter}
            onChange={setSupplierFilter}
            options={supplierOptions}
            placeholder="Tüm tedarikçiler"
            allowClear
            maxTagCount="responsive"
            style={{ minWidth: 280 }}
          />
          {hasFilter && (
            <Button icon={<ClearOutlined />} onClick={clearFilters} size="small">
              Filtreleri Temizle
            </Button>
          )}
          <span style={{ marginLeft: 12, color: '#888', fontSize: 12 }}>
            {filteredItems.length} / {items.length} sipariş
          </span>
        </Space>
      </Card>

      <Card size="small">
        <Table
          dataSource={filteredItems}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20 }}
          size="small"
          expandable={{ defaultExpandAllRows: true, indentSize: 48 }}
          locale={{ emptyText: loading ? <Spin /> : 'Sipariş yok' }}
          summary={(pageData) => {
            // Para birimi başına topla — child'lar dahil edilir (parent ise zaten gösterilir, root sırasındakiler hesaplanır)
            const totals = {}
            for (const r of pageData) {
              if (r.total != null && r.currency) {
                totals[r.currency] = (totals[r.currency] || 0) + Number(r.total)
              }
            }
            const entries = Object.entries(totals).sort()
            const summaryText = entries.length === 0
              ? '-'
              : entries.map(([c, v]) => `${v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`).join('  ·  ')
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fafafa' }}>
                  <Table.Summary.Cell index={0} colSpan={7}>
                    <Typography.Text strong>SAYFA TOPLAMI ({pageData.length} sipariş)</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right">
                    <Typography.Text strong>{summaryText}</Typography.Text>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={8} />
                </Table.Summary.Row>
              </Table.Summary>
            )
          }}
        />
      </Card>
    </div>
  )
}
