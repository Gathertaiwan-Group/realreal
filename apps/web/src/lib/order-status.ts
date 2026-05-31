export const ORDER_STATUS_LABELS = {
  pending: "待付款",
  processing: "備貨中",
  paid: "已付款",
  shipped: "出貨中",
  delivered: "已送達",
  completed: "已完成",
  cancelled: "已取消",
  failed: "付款失敗",
} as const;

export type OrderStatus = keyof typeof ORDER_STATUS_LABELS;

export const ORDER_STATUS_VARIANTS: Record<
  OrderStatus,
  "default" | "outline" | "secondary" | "destructive"
> = {
  pending: "outline",
  processing: "secondary",
  paid: "default",
  shipped: "default",
  delivered: "default",
  completed: "default",
  cancelled: "destructive",
  failed: "destructive",
};

export function isOrderStatus(s: string): s is OrderStatus {
  return s in ORDER_STATUS_LABELS;
}
