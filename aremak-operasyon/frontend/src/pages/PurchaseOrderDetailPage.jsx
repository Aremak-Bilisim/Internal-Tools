import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Typography, Space, Spin, message, Table } from 'antd'
import { ArrowLeftOutlined, ExportOutlined, ReloadOutlined } from '@ant-design/icons'
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

  const load = () => {
    setLoading(true)
    api.get(`/purchase-orders/${id}`)
      .then((r) => setPo(r.data))
      .catch((e) => message.error(e?.response?.data?.detail || 'Sipariş yüklenemedi'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  if (!po) return <div>Sipariş bulunamadı</div>

  const status = STATUS_LABELS[po.status]
  const grandTotal = po.items.reduce((s, it) => s + (Number(it.line_total) || 0), 0)
  const totalQty = po.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)

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
    { title: 'KDV %', dataIndex: 'vat', key: 'vat', width: 70, align: 'right',
      render: (v) => v != null ? `${v}%` : '-' },
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
              <Descriptions.Item label="Para Birimi">{po.currency || '-'}</Descriptions.Item>
              <Descriptions.Item label="Oluşturan">{po.owner?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Toplam Tutar">
                <Text strong>
                  {po.total != null
                    ? `${Number(po.total).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${po.currency || ''}`
                    : '-'}
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
                    <Table.Summary.Cell index={0} colSpan={2}><Text strong>TOPLAM</Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      <Text strong>{totalQty.toLocaleString('tr-TR')}</Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} />
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} align="right">
                      <Text strong>
                        {grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} {po.currency || ''}
                      </Text>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={6} />
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
    </div>
  )
}
