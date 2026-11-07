const ShareProjectModalRow: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  return (
    <div className="d-flex justify-content-between flex-wrap py-2">
      {children}
    </div>
  )
}

export default ShareProjectModalRow
