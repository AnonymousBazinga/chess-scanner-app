def placement(board):
    ranks=[]
    for start in range(0,64,8):
        rank='';empty=0
        for piece in board[start:start+8]:
            if piece=='.':empty+=1;continue
            if empty:rank+=str(empty);empty=0
            rank+=piece
        if empty:rank+=str(empty)
        ranks.append(rank)
    return '/'.join(ranks)
