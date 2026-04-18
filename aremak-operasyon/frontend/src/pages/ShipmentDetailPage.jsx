import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Button, Timeline, Typography, Space, Spin, message, Table } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, RollbackOutlined, ExportOutlined } from '@ant-design/icons'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../services/api'
import { useAuthStore } from '../store/auth'

const { Title, Text } = Typography

const STAGE_COLORS = {
  draft: 'default', pending_admin: 'orange', preparing: 'blue',
  pending_waybill_approval: 'purple', ready_to_ship: 'cyan', shipped: 'green',
}

const ADVANCE_LABELS = {
  draft: 'Onaya Gönder',
  pending_admin: 'Onayla (Hazırlamaya Gönder)',
  preparing: 'İrsaliye Onayına Gönder',
  pending_waybill_approval: 'Onayla (Sevke Hazır)',
  ready_to_ship: 'Sevk Edildi Olarak İşaretle',
}

export default function ShipmentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [shipment, setShipment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)

  const load = () => {
    setLoading(true)
    api.get(`/shipments/${id}`).then((r) => setShipment(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const advance = async () => {
    setAdvancing(true)
    try {
      await api.post(`/shipments/${id}/advance`, {})
      message.success('Aşama güncellendi')
      load()
    } catch (e) {
      message.error(e.response?.data?.detail || 'Hata oluştu')
    } finally {
      setAdvancing(false)
    }
  }

  const reject = async () => {
    setAdvancing(true)
    try {
      await api.post(`/shipments/${id}/reject`, { note: 'Reddedildi' })
      message.warning('Talep reddedildi')
      load()
    } catch (e) {
      message.error(e.response?.data?.detail || 'Hata oluştu')
    } finally {
      setAdvancing(false)
    }
  }

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
  if (!shipment) return <div>Bulunamadı</div>

  const canAdvance = ADVANCE_LABELS[shipment.stage]
  const canReject = user?.role === 'admin' && ['pending_admin', 'pending_waybill_approval'].includes(shipment.stage)

  const itemColumns = [
    { title: 'Ürün', dataIndex: 'product_name', key: 'product_name' },
    { title: 'Adet', dataIndex: 'quantity', key: 'quantity', width: 80 },
    { title: 'Raf', dataIndex: 'shelf', key: 'shelf', width: 120 },
  ]

  return (
    <div>
      <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/shipments')} style={{ marginBottom: 16 }}>
        Geri
      </Button>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <Card
            title={
              <Space>
                <span>Sevk Talebi #{shipment.id}</span>
                <Tag color={STAGE_COLORS[shipment.stage]}>{shipment.stage_label}</Tag>
              </Space>
            }
            extra={
              shipment.invoice_url && (
                <a href={shipment.invoice_url} target="_blank" rel="noreferrer">
                  <Button icon={<ExportOutlined />} size="small">Fatura</Button>
                </a>
              )
            }
          >
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Müşteri">{shipment.customer_name}</Descriptions.Item>
              <Descriptions.Item label="Kargo">{shipment.cargo_company}</Descriptions.Item>
              <Descriptions.Item label="Teslimat Adresi" span={2}>{shipment.delivery_address}</Descriptions.Item>
              <Descriptions.Item label="Sipariş">{shipment.tg_order_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="Fatura No">{shipment.invoice_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="Kargo Takip">{shipment.cargo_tracking_no || '-'}</Descriptions.Item>
              <Descriptions.Item label="Oluşturan">{shipment.created_by?.name}</Descriptions.Item>
              <Descriptions.Item label="Notlar" span={2}>{shipment.notes || '-'}</Descriptions.Item>
            </Descriptions>

            {shipment.items?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Text strong>Ürünler</Text>
                <Table
                  dataSource={shipment.items}
                  columns={itemColumns}
                  rowKey={(_, i) => i}
                  pagination={false}
                  size="small"
                  style={{ marginTop: 8 }}
                />
              </div>
            )}

            {canAdvance && (
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <Button type="primary" icon={<CheckOutlined />} onClick={advance} loading={advancing}>
                  {ADVANCE_LABELS[shipment.stage]}
                </Button>
                {canReject && (
                  <Button danger icon={<RollbackOutlined />} onClick={reject} loading={advancing}>
                    Reddet
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>

        <div style={{ width: 280 }}>
          <Card title="Geçmiş" size="small">
            <Timeline
              items={(shipment.history || []).map((h) => ({
                color: h.note?.startsWith('[RED]') ? 'red' : 'blue',
                children: (
                  <div>
                    <Text strong style={{ fontSize: 12 }}>{h.user}</Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 11 }}>{h.stage_from} → {h.stage_to}</Text>
                    {h.note && <div style={{ fontSize: 11, color: '#666' }}>{h.note.replace('[RED] ', '')}</div>}
                    <div style={{ fontSize: 10, color: '#999' }}>{h.created_at?.slice(0, 16)}</div>
                  </div>
                ),
              }))}
            />
          </Card>
        </div>
      </div>
    </div>
  )
}
