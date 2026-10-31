import '@plumeria/core';
import { relay } from 'component/relay-order.styles';
import { RelayOrderChild } from 'component/RelayOrderChild';

export default function Page() {
  return (
    <RelayOrderChild override={relay.override}>styles first</RelayOrderChild>
  );
}
