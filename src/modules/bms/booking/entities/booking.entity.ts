export class Booking {
  id!: string;
  bookingId!: string;
  client!: string;
  service!: string;
  date!: string;
  status!: string;
  createdAt!: string;
  pickupAddress?: string;
  deliveryAddress?: string;
}
