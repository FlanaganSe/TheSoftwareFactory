export interface KmsProvider {
  wrapDek(plaintextDek: Buffer, kekId: string): Promise<Buffer>;
  unwrapDek(wrappedDek: Buffer, kekId: string): Promise<Buffer>;
  readonly providerId: string;
}
