"use client";

import { useEffect, useRef } from "react";
import type { RodrigoState } from "@/lib/agent/rodrigo-state";

// Lightweight 2D render of the approved Rodrigo concept. The source WebP is
// embedded to keep this visual proof self-contained on the branch; once the
// visual is approved it can be moved to /public/agent/rodrigo.webp without
// changing the component API.
const RODRIGO_SRC = "data:image/webp;base64,UklGRopUAABXRUJQVlA4WAoAAAAQAAAAKwEAkwEAQUxQSFkeAAAB/yckSPD/eGtEpO4TEgOwjdsIAHmv0f0H1kdygoj+TwCufwgEuiOCiiEIq8eb7QQANNcsci7muUYrxVtVMXhf9xhRIb9ZJXoIkhhAkdkTG5KpAiQPtyWIGCEPkUYg80odcbOtAaCX/Fejt5xBqiQKPpK8I11xvLDZmbtw07eJtSUX93GCSaz/enTQvgNrdAmrZ8j216Edftqwxtrhnc4tHOCF7iITAAaQOUdHki4jvzyYtMukzFwiSFLqIIkpe5OaAGiKVWE/gZlvAN6Q3wywBN6w/V/nJv6/6/F6xxprKrRN3ag7urivu7vvftbd/SPrCuuCf9al6CpQ2EULNaTupUqplzaZeT1uzGQyM0ne77kZERPAwChFaqVjckedjJpSZ8KxzY0ghl50TnMZFJT9FOqOtLz6TTMn1RsdXX4xIbBg8+E3E3ojICjjBfvYsz90Nj1/J0hqeN/JPwiVJma8bgwEZTjJTZd86EKIqCBq7VQk+OTyKb0QHbfG+9/bCUFZTXDW5y6CSEJR0/0OAqL9S7N6QdM3ctG5B97bCVIWkxj+4XdCJBE9Rt99igQkgVINX+t2tN19/3s7IShzCS5ZkiOSiBLtZ15IQS9D4i4f+Z/P3Ntld9//3k4IylSC2S+emIDopZueM7IOUGnH9sr5zwZGvvOeLjt3/3s7QcpOFpMvm0AM9Fp+w41jCZRqWL/b/sNgAox89715O3f/ezpBmQnURl6UtX1GA71VFIvHIgrb33JPt5174O1NKBsJLCTKawaVJLCAMQSoe8EnPvbKzs53/LvLPn7tJJSFTGU1+lzck8WOLggQEKNX2t2P/eaC4e9cavulhCwEuAKK4bzE6omn18L0wQQQzYtjzvaNgSlf33jDEJSBTIXFzLH0YDA0TqBo4IuOsTu3fEyA6cPJxvlQGRgzihINNoBCSPTC447RBy4mESgDiSf24orIg2cXE0P/DIhCG3iiDeOO+USCyL5mx71U2vWX1UeB1PiFPINE0dFzxp55/DPLQGZRnUUGVgi7jgdXCGaOIEDggsMeMg+EeOWbT+ZpWfINZJg7kmzUdTiISotpi4rNvOdgyyAD/Pm54Fwy7/8PCjFhGiEDBR7fiysXmy+RKBx7iWyM3/zI6YTA6X9/Aosh87JQ4MwTVOf5o1EBIBB1P1kxfqjFrI13ApHTE5R1xIhbqUoxYw6hQAGkmIv/Xt8wyeKUoctzAmaPykDhG64OaB5TDHCkbf5bX/f9FQtQbFiwdo8sJk0lZJyQnzOXWBWKOr8uqoiY8onf3v6L7517rwWcceRxrDh4Adn3EptqPXcKPb3um88bLc59YIeimNGxDIFOq4vKNMqPupBYJYFJiyhugnPRXpDbBWLk9DufETD7FLINend0qBKoa+9BPPJMnaQZbQ8CMZyxZitRTD+dTBvyixYRqyayMEQVwNonseicfEc+GM7oWgVyy0KcZeACnFC9IxOKRjbfB4rhzE27sJg+fCnEfH5SvZVhYvNcoyqa0FmMkHvYAk47tBrskTMe7gqhLlkwhAwb4qxRVLEYNxIVgZUHZDGzfaljULhw46PHVyy5+nvHsoxZkENV5I45FBedS53L57tf83I7f+DRD4UzLhvXFiIZVrH9CmKoHlw3ERdB4VpH2x8eddWP3nzp2AaKhphhguc0IKp6fqNVJPBOH19305dn0mMIkkylVeC0xgU4VNeYDoqLzve97NQmCkMQZZTKEgtCMTtdiYbZWNUkZpyOivQoUVbJRJdFjVGxuxgChJ2SAp3DqG659TR6VghB9FICg6LRyMFt8xu0eUMomD4ur4J543PJ8YeOBJ1ceeTwHjAg5HQ06wiqKsykOvfQWykE0WPjKy5VR8sJw6H9BT6lld56V/eutSSHH3ps89Ok48AEqn/WEKsMCqKwedLo0fOl3Ohuem0ViQUSJXr3hpXecR0o9RDmEZMqcxIoowz1HZMWTJo/Y0RDPYV5JBC2ishFVICRwQYFCv99kUi7onkEVa/jXb2SlB82+VnnjT71FAHEAolqNQZp/tDUE1hYj3rn6Ao4bP76QbkECRsG/+g5QwVEBCqo+jxgO+W825RToXzW0c/ejikukQcGz5p1xUsaiEj0YYGDUo34FA69yu28dz0qFxx5TKJQcjSNU2YuOmPhMGHR93Nro1KMaPg1Vi/ME6+c9b7duGyqN6DgaIYsWDTvrM5GsAP9oLnlP8Q00/IvynjijtsPjZyLywUoyJGR58yfZ4CIRL8Yw+ZvdivNdNxZBmvfz3OdX1csl/MhH93xgstH5wBbiP7SoevDT4Q0M3Ea6hWcMjXuX4rKdfAVd7QvuvCihYMhItG/yqTaeSPovWLTBUnX3Tm5LLLuu/nsizogIpGxp9dH9Qo4eyhr9lJmUWhLZO9uyikmT2XNUlweMJbI4E5GlGnk+Ry/yypXv66QYuTBC8pCZH4D/9kpDzy7t6cYCHXlgdMnhLWPMeCY3dtwiiGWJ3jyC+KQ4QzATxxWqknKQwx//upmh4HGIf+vLpFij6wvE+w7IQZcs+Z+UqzDyQ1lAw88cOsmxfQCnERlMgOv9fTfLFLtI0fl8gzE1q33y6lGB7tJi9aB606mHHc0pIaom/5DJMUqzvhki5UOYlj7nS6RYuWOb11skQrlSWcjUg2Dp9ukQrnh5R1ON+BukRJYOM8i7Yq0OGia0k8kHYr2GaRfnToCpQCT01CnnRA8ahgpUCQfeilKOYq5jnmkQukXP3TKUTz15WceB6UArG5CqpGf+y5So5i252CakSe9kYiUDmDwIQ9NM1xGTERKFDNPH7oTpRXFcBqI9DD0M3wzvUDdWFKlm+gizeaTVCH27cApRqRJa8/XSTWp0uIT3xZpNqQJrP/7Amm2+4mUsee1d4XU4uCNhBQBfPjKeqUVYE8XHmgcXTZr3xv/DkorZvnd3Rpogqjg9rsfffYwUErRjl+exAPMtn/urQBw9J8vSlAqQfmtRxlQrRPfGPuaAxWIsg98tRWlEjiZG2geff89l/36lFxSLiBPxyCnE3PRWGsgAbbfc+ap3t9aAYncE8fSiDz8ZZiB1QLIhwqA2PQgSiFMno4GGGyJSpuH1qHUAXOHDzxVaR28kZBCGgKp1FqckEJNOo1h42xC+kit4pMofTitRF3UaqWOpM/tb2nqnxxOm0P62HcS96nuJzsbC7qPup+BEefhlGEeXOe+5ZhQmHuG/jayoN5KGdpxi9Sn+vHI3BGkTcVbdiumEjNhNkoZUQ/90HIagbZTUgfEq34knEoIOHVAxIpW6ojhDEWlD4RJopQyYJhIoYLHH4qBKKWMPKnUHFl8/ZvODNhSmlA6gcDu0c+77MwJgVqoHSINUy+YvuCCGghYisB7flwTASTlX3ANrok45sPf37ZNsSYCdA9rRaTHJOXc/CgmRR5yijHamCNFiu2W04o5fKROThHmiuFWWgndfzkg0qQ47TTSirhvMU4Xbp1HWg3d39ikmCow57REpRM4N0fqPH0SKcWcSUzShRgxk3QaPLKTtKnYcEVdVBqB5ubUAUxvIaXW5dLIhIkoncw9gdKGaG4lpXaQPs261TidRCl1QJKQUjc8ReoUU6ejdLL9AE4bMKiZlBpECrXTidnzRBpJq9bxrbUTxNLu4FoJ3LuBmonZfj+1U/HqN6KBwgdyaS9O/HR91IDwzFHqlfKA18126PfyBqHWpEpiTC3BU94g93tHu6CplSo1mzfglIK5YrLVXxkVsanqIwdJrXLbixqj+qn9TS1Fqn1fLr0AZ51Of3OgoaVIdxL6xMpjcmoROq0d9S9doa5In3TIbUKkVzupMylyz0pSrRDglGDWbcFpBjApcuVhpR1QBKcB5ZZZpJ+NOwiOHuii9q4iDXdvvPcpxMC/ZitOQYFl1y5+eH/3ACeWHFQassn9e87F/yAOZNaefyiQihWAr+fztgewXa96UE5FoNDyXTvGgQs4OFExKh3R8fo/2s4PZHSe9/w6lIYKh/zyhD2g0fHaWUbpKDDsijf9dA8ewPLU0YBSEQGm/28dA7lgaVtKCnRcudPD0ABGDH9yOhKDf2pHBvYYbiEViSHfeLejBjiHnVfnE4X043PeigMD/8kt5GNMO9AcEGnw3s6XnBdQ2tm4E6eC+LLFP58TUaqJrLyDdKjQ3NjoREozKL8KpQLsiLcT0o3u2SGnAiT4zxCUZuyT3aTI7g+nGnHKpydZqSGGN49zSC/4vW8wKdLzXkV6lce+ACtFxPCSwVFpJXDufAIp0sy/gtQq5tebVBnb3j/MSieiZSEpA4Y3kVID42egtJF3WklC5xBSp0ipCnyPmql43jq5VsJrdpNGQ5B7MKAyaaAJzNrgmELiM5Gq1IDzAedJoa3n761zweGmvXuCkyltUb1zMgkNNO/I26kjMOE6U6hDTXueTFw3rT1ShvoHFqIBRYy8PaYPSNqpSi8eJg0kBF56AKcPXIILVB7ncl9mQFF+xvMiqT2Gx1+xVnHAUJz8AdJ8DJ/9GkjYA4Bi3aeISnHW0vc9egIgEPs9QjzcpjQHfnLpwb0rtj16BOT+SwIiuQ0zyYBx/7IlSx5A6ndCEWMKkxmTSPs2ErDrm4u3oP5EItLjkFH5jtlTpwFKeYXGUveGnw9B/YVCiBDOH5uXcqcsnHhqbAKwyIgWuX9dSlB/IOVN+4J5C1otIFDUJpAdY6ibsJ++J5F3OOeCWW0AASAiQGRLR7a3ku9bUjTDLrxiGGCLoiKTCibNaER9R4KOeRfNOwG2gsi8oyc00mcFi74/LgBRQWRgUTdvBOoTCoz52HKDrYSs7MBQVHVBgvOX2DkpiOxs75hOqDIB1L9nk2M02TqGxa2oyuCKqxqajxETMrbDkWsJVHnd+Ne8C3BCxnY+WXUvqirRPreRvFAga6uOfz8tqljgtjZCIItvdeNiQtWEIAhgMnkM931nxHKqVkCrjpDVDY9QzWMu/vzfzjya2SDW52O1SK9+5KDdKmW3FqJcHfLKIYNxjCazJ4eX5KhOaftfiQ5BZPngOlVFcuzxbomMb/JrukMViDV7RPY3dz+CKiYmb8I1AIirE6lSgS9SG3A4/HwqJbXcJFMTNDe3osoEXno41Ar09MsqFHLjXkut0HrqOYSKOHk/do0ghutBlQj502dQQ/yvy6ZTQcX61xGTrGUXCPUuXn3d1MrMmEbmtigee1KBMGveIFUAZnWhFJY/PDj0Hevp+48FTxnd0tZT0UhMfgIVUL7hhcQkhcXjLeozMaz/2D+7oXPo2JnGzWe0+tRhubrDz0wBbp9aCXROgsjU1oZ330nJgxImDc0nh1qeHcyXnlUJ8zJikqkcNnyb4AIVyJFqlTtHk7GVu5Kkm5IFIggVrUTw83KETGXt26BIORvaEJUVLCBmrbVNlPfU2VQ6cO4QRMbeGcrUmDQ0VWxIPRk75O8j5MsinnP9KFSZsd0Omcrau4kyi0XXzKyIqLuAqEwVtaYZlwdIApUUIw/JZOwtKJatwoHntolM7eBH6auBOXvlbMWudch9Q/pAA1l7XQOmT4rOFfVWxlqNYt8IvP0EGVvehNw3xA9sZSrr8Ab6bMONNtmKLV19RYycT+ZeVYf7yszxKGutI+T7Boxrc7ZyOLGavmoWyWQrnny8r8hNY8jcm7fjvgFNLdlr/TOUrgKpGsSw8Vkr8EQM+VLkgmqdPQ5lKnN4PSXLU96+OjD7zQ2Vi+Hmr5KxzbY1JYkF9z+59eV89v/rUKWsH/xdMVvB4zuJPQUmPfTPGX/5anLbRxQkBSShoHJYR648HJypLB7uDvQsvrZ6Cj/7wpTlz0IAAkR5zcP3YbK1urdQYmDmsjfTtPjjr7jvxRcnc187+UzmfGEMbS8+vRxh398ssrV5cnVpH7prcFiw7PKrdmzdM/8TW27+34U3b71yyNfveGNT7+Rr7lXMWLB2K+5BdCz5mvjgvxastA9f9pvjbx5+y0++feMZy86lrldS7g9HgzPXiqMqZdqTH6fz7o+/7Jmclzxn6fu48A9vXveaCctfiHoHCVnbIbccUeL0XR9sueXOjv+xu17zsX806dO3/n3nG/ngvVNRLxQnbCRmLTiwnRLNmBUP3LH2HD69ZvuX6z76IXjX3o+99cvnX//IbEIv4FUxkLXN9o24BPHse/9yOhozdf4gxgwVQxbW0TT7688TvQxx8jmKmQs2HaaXg+sRpYteS+QZ0xicwdY8E1ySQCAFIYECIKkUKW8Gdc7Niazt0L2OXoYkiAq7fu4FZw3Ok8X3rOpN5RunnH5pJ9ncrNuMS6q74HPvHFwJceYDEWxCBhMrjpQk3rT+z/d9uwkBAgUhAUHFYFN3cy4JopfGPUmZxepa7kDJV/0tee7SiSFBgADR2+5cklCyMQqopwxr9q6iVLn97x/j3CVjAZJmaDlrKPVN0LioHRWIMxdQojEJgvxTuySrYPjozAJrt+JSuOSxeQ03XNv5vrcPGvGL+184+v/++O7O628YHT67++MqUGx4bUdMitkJgkNbV2964tgJRWJeuVFXXeLssu1ISfC5u8b+bPvrfu6jr/3Vbbd/6cfvfft7f/KnX5//rmd8WxNF60dR1FaQ96zbvnzzyQaACGGow+FusooDy2OgZ8X632/5y73P+bS9+Ad3ddRf8bvW1lf/ZeL/fehx5/9HKtI4pMBOxP7HFq8ZVAfQ0Dxy9KiFcfwszDiUVXh6JaWKGf/+zjtG1P9++S/HXvr7cxhx1Sv55Ctf+rcfnrS/TCjSdRDsRCc2/O1eU3TKi+YOdXKSnrMKbFlXElz4ryYY8oNF553De5bP4tJbJ370H/e94ou++aofNwBYR5fZiQ7ddvsBIETCgtMWUjQWk8isq/bKJVhzvxnq1HT1v647+4yfLx7/rJ/+T8ur738V535mTMOUUEDgUw4Hb/nRChDW5Oef2Qg2iKRYdg3x4ViKGLHkxQQ4492nMmzOCIbPbqGpHVFq4LzVD165AkJw0/OfM8pggsjA5uRmShXtH5hSAIgShYKkYmLI6cshgPnA2UBUIBub7etLKlFBKAgFIVHGADLz55ILIZCdd+/DpUmi12WQHOyJ73tldD2ZeuUhlSZR1tAbkNsu+cAkMnboftiil0OHhd40v2okvRV6ybsvxQ6ZypzYRi+nf2vJ/V9sQoBUELj4tsnPnkAI6knwzveCJTLWvn24tJ9tecOXVs9RIgQIBX3zExOuH0/pg+ogTwZf00gvr/kSMx4+DQi0n0Jhx3Vv+dbuK4dNf/1oVODQ1daIlMWWSS5BjLv5rNbf/Lp5zmdmcf7Nvx77hunTXnXpNe/ff+2rzr3fHyQUkN94gizu5MRqRImBN9x/xfU3jVy0wj84/57vf+f1ty/66df/+1sv+etQfuL4mSJm3VaymXYepFSJr+340/c6GxfbV/7y6jDqy184a+OLfvXid3yChVt96JIiWvMYWX1NMy4hMPRevxsu37Xhl5Oec/U0fnnNP+88+88LfvBWPuyntv5PIkz3TYfkjPYIKu05jy65awLvvHP+ua1tX/pL269Orv/Wa2875W+r3/CBrW997ScTgCWPymRxB29ClCh98ycjrr1t/vOX3fClM3+34ieNb/vv817znI/XffSWy9qmBwrDvnduzWx791OqaP3Hmxj+q1+MeNtXOwddfPlQEmisS6irA1ABtDWKjL4+9KL57aeKxlEJJYqiQhFAsfHVw8nqq8AlFBcgiRBEzzLFxZSX11mZLMQVhHwvBBIVNE8/hcni1rH9VKkEhCDgwqkoo207XjkpgE2Pbn5HR8xm8FgDroRCCBRtOCW0zXnLmzph8lSLTC4vJ+TLpBCCAJKhZ44YvmjCjAOauPHP82DUCLK5w4l1lFchUDjstFf/7x+WbdaO/PIDy5/SrJYAR7vkTAa7cmUCkvHP+8Qv793y6G0//c6rtm08foyeV3x+c3AWs3blcVnan/v5Py9/4q4bPvHS6Y0UlQpsOPGjt62RMxjsbaaMouV/197947ctbKdQChjTs5IlH94rZy+xFMVyNJ++qB1AIQTRazss30P2cjiyHrl3xRWCKHc8czzKXpw4JMBlCEGUX255y+CYvaJ2dxBBKrBLqax83uWIzG3Gf+bxmw5xyAVIVeLkMhyyV2F89Om4bN/abfXHtxwjqhpCftJssrkdKDx2NDm25sHfglQ5mHkso4FdECjc8OJmolS5BThktOIGTJg06/Q6olSZ2DwHK9MVjyTPffM5CTGoEsxsRdQCFRn+ojefUw8KKl+HqRFKkeHP/+CbxgBB5cor1AhAiow8ueyHl7eByiRTS7QDHFj2x7/sscpSc7QJ5O//dkKN1A4cnJfUSIB80hJizQQjVDMBYrRqJqbrsZxcI0HsWE8tdfVuVCuxWXEoqEYCOvw4oWaCti9ANRNzdb1UM9HBV1AzwX54MqqVkPf/EGomZvdr7w6xWAj9j5ELjJQBiOHXb8kbYbNrV79jYRWIbGgOveUmOQLs2YP7FTvkjrcD+d1dHjwsCxDDg6/aNm7Q9Ed2MnOG1W/YEMh/55/TIjq5O+Ze+MFMgFmybWF762vu4GRO7nvRBUHA0Ttu+e0xwABNo7NB8eMRln3hQHCf67F797pV9/zjOIGiITaQFW0rAvmffc9yH4v3rKu3k/WrN20+DMEuBk8ObbEyAVgCAhNfRVRfimH198hHZECyKXH1sBFkTPPhOYS+JP+akAcENqWLzBl8/utMH47J6pVgsrKTN53ivuPQfR3Kk5mDz3g27kO37yRjzxyO+4iTPdcQ8uUzyhyKrS9V7Cu+LihSdteREwhlCGDKQ0nsEzHc8hhyuSLb73t5E4URpMwgTJ8UoyZSSbnl9Re6aW7r8AaCYmboq6bRqBKFon5cy5zh4fauYGc6xk+j0lKk+Ove+ICUMewq60hQhUCggkO/f/PVT9mZgqBqCspHqlfJunctVqZQN7hKLHafQFSx8yG/zsoQZv9K5KqIYv/jVL1WPSNnB8TB44epwhjDkYefBlebo8mYz6w4gV0JO0Z76Su3UwM0+Wd2khClMjkf7U1fnwyqAYB49O4tFjZSb2yCvfFrc0GmJmix4Rffu2fuUMAGFTEgwYmVX58LEjVD48dvnD3vZTNG1NHL/VsfuGMcKFBLdBDQMXn61FlDZiUG1P3EkeMPr1q/Gwj0XSmLQEREIGkZFyjMbzvhPEii75otO3AWKZQgUnIAmz69ezeZVqgHY/p+sAnKLv2t6ghEgQGpxnFy59CuIXX0aIcahjn+lUfDzEl5xRlTcg1zmqlxbt9O0fq2WP/cSZedV9uQikUKR335HYlrGHYxAVJ+/F9n1TJ6Kemn74i1EtumhhrqayjKPeRQM4FOYg0lETXULmqnZhiumYh1DjUTGCxqqDu6aynbumTVTMbWU0Md1hBR6jEqYg1sZsPOIFJuJMEYVJ/3APfP114/djLHGu7Z9V6cSozY1TgMIf4+igH+5D3/tS82Ow7Wuf2fUfUZsfF39zaNqF80bs7uPxIGOETx8O3X5EM/BzFUl/N5e8NXZ1MY2hdOkxjwhQAn3/iI1K9Zh7uGG1VRzNsbvzoHFEIIpEq5c+IJcvl+LIarf/+1hURCddiSN351DihQVCGkB6D797dcfyy4vzJ+z88nvek9IyFKFbMDbPzqHFAgnYqnbrnygiFR/Y5dID31ogcj57/+oulgSxWwCXSv+sevQYH0GvDcYQT3JzYECrtZ/eItSR5Nfd5zzm2DiFQGYyTYd8ff/rELBdKsoat7i9U/GCMEnNjmZM/KBw/tXZqDYNNx1gufPaEebKEiLjASwFMrltz1yEkk0q7J3/lAvs/ZgR7z6x/jztsVjuyjZymiaQsWXji7DYgFUkHh/qeeWLZk1WEINilY7HnjJydZfcIuIuHIIT25ZH39vvu2xRyABLEISBEYsejiiya3NxRwpFvhwIb8qk2P7XryBEg2[... ELLIPSIZATION ...]0X5mB1/pt4XBDASe62NJSEivdrgVBIKczwmd6M3fP+lwJuGb6Q/D24EEOLxC0lsheoiqc1BjlzZYm9nN5i13vi+qwoiCZKf5tV/8KVlVwnOh/kRWcaOx/OYdUJ/0ye7wImWD0+JG0GzWSLSFlMIXGUlMXuWTWK4D3Kpyo/CMJghVhFdWFk2J2DZJI5SGhhOg2ShqIpWO9VwaLZ4OLejJZvbnMaBPmmptrePNfd8PlyosvjFwpNSKIVY0tfLM/x/AQ5uJEM1y3BYt2PU1wItCqqZ3Ax5NvreobCQGXSo2SwOZlAaORvqavVuq+IdXaEE60r8vqVksAn7ZqOkmIaFVPKtfK3YKJxPZcDJyRdg3zQh9XI4ISz6wd6OY/KyG3eQ3WaAZz3jiI7xdY/TwzmSeigXdUwBDh5SXQqFilcNYTVTXxsrkqfQOKugaNpQZ1YCCwxvvuPOCj/xJnxdddEXbWSYDpDq8ABya6RvEb6FoPck2ahN/g5sgPzpK0hsL39I44zCXygQaFVFzLi9WJWlecFDX9PsfhQxA9a8W/QPm1l7o1e8hMUbHv1akSSKqQy/hpmCFNREsuB53GjB87wydxAOW7Z3Afiuf51iK2f1xU2Jdug7TIiOba1XKZHTVsU2ZPoLO3BjqSILD0ECbH3fh35+DzAYL+R+uUoqLpOeK+1ekxJrBOPdBrOusk0MhWs1AEvjuysi3w42LU/kipysNZ2EuFxlWqyOAgX6H7DbhLVNb7hzcWgl6qU9/vK/IBE9SSYjj7W2lzy2bGHxLhl7hFvDWcza7lh1/bnVJE7sUO11oFCDPb+FnZXzfpLGZ/OqQjKsBjclUzpERAiSmNs+EptbdMQYVJv+v1PxTNNaspPTRDwnZ7n95MxrAu23LbKXbU+7KLcLsYTkDRPfT5UvCjUKDsdTYL/9igjvYN9oas6yNWUJ+s3Hm8+ubOiAj9miUENplrvaK1Q7wYr6OGZngXnvq/WhtYJXcdCKFr2WSgwcOQXDZOOQOfswIS+vffbSLlgwrptJCmrwkL7geNOhJwAE7Bhnbq6DKw6y9mV6SDS94s3/3bI/jq+nAGUxQV2J3fSFL0Df2ITV60BdMQv/RQqAWI0u5EBi9PjKug0NOyo6MmJJMNp4vAcS0ksDpifplSU69hqIYrLtcaIbIw0/PCRMLRD/WgvkdTAJoi+5cp89bR4RCLxYFgM9i2+BBE3WtKPWIZveAAafLPXtlbFKb6rOPdh/JK40JiBvgdkNkgJMr/mQM1Gqkdzb08vujlZH++jviU+YC3NdqfhU+kvKt+D3aRLFGZu2HnEbgna8SsjtAaKZItky30nKN3LQvt8PAnJAS0fVofALp4aEkLuG1LvJOFojJ+dcHb38HiMoIYFxhuCgFhKrYZwcRcORQRpzUeg8l+8IhduXK1WdhWNUkzkKt4RT/h/mMyM+HmYnZFXe/HLm5MIEQizn7eLBw4bBVeIyHw08kLYz98HcvxHdE7G7ziVVhxDS1XL/EFoVXD5ktl8E4tjPtze7ypnbpmrIAGuohxDhKFAlP9PNe76TgKke0Lb+gAL4650SMNTalcBZ6Z79HUGDCkvziFl5ny716qlFyvo7+PBGuxk8UOS6SrWQLV4+byTrHIoFSVvI7dD/9RT2VBnPdDSqU6ujGnTQmNziKq36IQs48VUIhpwE3haoWufcS1uLodtJOVRObpvr6fQR3C73cMZMMMwhTuyyEdP5WdN2/9ySvzs3WnLZfpIl19eq4YexHHBfxONv2MwoIF8H2fCuqbDn5J6MwcsWA8eoHQzBYYZEc+UD7uZF3yqNJLQOK4zd0cZJdDa+4ukc2ceCjydN7KePQWn0bsjMg/F41bPAsIVwklgmuobKX5erPYN2VCNqL9iw9jmeqqI5NPriX74SOAbGc7nTqQW9ZJTdumHkZTXE19rdT+TJJ7it+UWWzp/npJ8cVhNAVUk3HiTQdOeX9GbCQWBFsUL/ezbFT5GtHxtGALSIgDpP7XcEIc5+U1CKFQpy2mRh95yNLQAXxka1tQglb2UwwTBNquM53IWgRydNVoBFtZiR3A1B+i/uUKMHJeM/dMnqqcbPh9XgV1kFoBWg3BQ1ESBZ2bOfcQcV3LhpibeemSxATdxQ8fcfnSOZWZM5oT+1/EbWhyn5agZ+8twRmuUgeXWqZ1mzOOrYhq3K1381KHsvLsmAUdXGrn18xOIRVjJxnEvkdcf7N1PwxOe/RumGISvrEZgSzUG+2XaVismPA/nk5sBx0Cs77BAgdvQkyVFqIKuVsgL4vMbYCXhERRsPGW6e2F7xzjxu3Vu73tlrRcpjtJ6StJggZLg9DbISfL7I1GvXOL6x8lQmxrr3yrD2gsMAefNLBK8lUmjGkmsiGB665qEHLNHi182QJCMa2plADpW7K2GQ5lUWe72SUQk1AreBbaFDNs+RYehWMa2+LeF1fJXUVYZ+RvdOGS92cHKJozCHfeRJZWrS/7TakNdNBmH47QUgdXWDbH6oEyT4rgqxlOPAnj4QtUXhdsjh1yeXwTdoFpGXGyNiNc6o66BqAiNYFwo81V+Lo00NAbQ3P4p90xi1N4THuCnljiUFLebXZDDgQznqqmLCylMbLOn+52Gck7h3+RfUbQcSOfzkouVGKH-3s5EnmiKmeF7QXyqf9icx39/gBFOLuaJzpXpRmVBCGf9koXcCwGdEju8jW1f9sClMSrLiIvC9quFoW8IY6NaTd10FxIaU6UjE7P0tMRQlkQ3+LqW2XIHPQJIwoBI50KEbpbaL0mYrNkbgsImHVVnnuCUkLbEn6HCpApfgLjYW8Yvr95VoPL3F1K8zCgg7a+7U1ZGEzIRG4XLSlyC2lkIjQ09RthjzlWK39AqoOpAwoumoOkKUFGla3/8LvRzIMtoABmf3IqgSA8xW1mYxPUyZ38JRLHPvScq1EreEWIdpoQzbBYjBoKRxgryrQq/mm49E15k8FoKrg96i/MXDrPe1ZKIKhA8RCOOGiSFsoN4mnamQ/CelemrboHihV6Gy51QKj/2oA/7oyDIpENZNGM3fOlBGdX3f737NgBt75eMEVNf2V49q48bt3vQjE6vNIYvJRxTffw1OYbjDKFbwMZhGfLeBYyYlrv+RL6Njnac0fu+wmOmD3zAA+SflXPfmiWeCidlOqPYGktKgL0Opv8grHFrYF4HLYfqpNYcMNLZNqi9zLUg2oINZk4LATCiVbCYjh7FccdarkiirUKCyu/vUYLqknOvqlTxtKDcDE+xAslWkpfzMmaSsuh0EsuhCQ+3766ql2xtvZQKRme1JedgQog+dDKsw1MJjB/jU6LGm1N6dhYyS8ndm6Rike7F3vGXhYbJdG3Sn/gHz81tK/9j8SXwJIQLwdYOVx0TQGo6A1ntlnr06azT5MMqMSaMQKkCTZIWEj7g6ZXOWEo38ecAXMUOxpb/J2zBN67oAvpId1ybvdCmKfXZspwIrdQ1UmZ24xUFE7F488ovtETgNuDWaHsJX4KumwOzPtvBcsh4E5cDNOsGTB4z0jyaog+Y/DGnm9hP473uxuDJpsq822yqbrPGzJG6/HW59H2E7hu8WCdqSCat9A4jSeaZ78BO2Zh20uyyoFQ0R+400YQXGeaapqrZyUM6T1Q04ptf7+TpNCx1mCpfX/asNkJsXbfxc+FQ3wWwlTtSieeBNYJQqc/rOeys9cJ9GfZXnr3bTm45BGlpkub0WnXkXMF7dEe4y0TtQzSXaZcRKAHUlvr2/w7nCxA72mKOfD0rVZJ1FOtEYmfnGc04FsAEbv8cd6J6ujF+k9VTuu4X1Yap5wH4XaaGeoakUqPWbIGwXatN4FxSUjkOxnYSfI3JhUIxcszoGldUcodhSebe0bjRP/uwOE1NGfZkesvmU2jMZTg/TFXrN5ZBjs1qJrXTVtbyzoOt/t2h+Hctts0ymEJdDq5Ji40PLvyJ4TkEjBRJBj16ur7nxW3LJNexlUxIW7A4OAwgxpWj1Wj2HqAgAPSNq87EtuFNk82/TssBKmCTSvTzjMMV1D9GPPvchOr6BSHE+nCbVEJyE+K7TY8rWxAN5EA1AxBpatYoMZ562cuDGGHzBWD/UdgWfBdoAe5DfTnKQ4rG/e2Qrz/JPdL97lbLT0nUu2WERNuUNJbaV85cfimmfEA3wgufzg1tmm8nuMSzgOjC90R7Iv6DvqfMzAzU7OBk1ORf4E9s2MBKa1lXyKY1Zlq7giqoNqnoHkln3uwfyVCV/APXw9l2Lz56UYzUS0l60t0sXgyINDeBP0kHjNnan0jelK2vfi6xkh5rKPggtujdms07+pwoDDyWweXrLmTWfPowoAFyWukyB5oAlB4dQNZFHqNAol7rQNaY6LCz7aSfR7c2cMSh8H3i1mA+r2HeDE6RUHUOSm2kl5T3KiZY85DvJs68z/fitC/TllFbGGhuSmcPriHfADRNREv7aWsdzDEuRkvNz3EqNqXkKl5KHkC9EQyzb8Lbg0Gyx4ojSV86ydPXPnjZHY2pEJzdIgwwQ2/sLBHVg+Z7OAIOAOnkQ+cXbgDe1CQrJ58LC1Kp4QFsQOZClz/+aXKOAfTJGiKg2BaAx4dSO8X4RAjPbmcCw6FRtPDfKWOhN/WlvPMcx2BCO65QLnJv+lBMMrAfAk9h0QD4CTYclS5exITS5JM/mEsuamJOjETHRX9NPHORqedgAFrpoSBw1sWg+DT3GqI2h4ynKqoFr9INwKAurVgumLc2F8uXrWJu6eAObZakeCKMY86Ktx2nGdqhNgpiXBjKGbyTHoIyGsXq033UW73r2x3KcW3+Eh2H2tpwdWpe2s50CL3rFNAepHqz3s18uRnPeamsE2zg9QCUcn3Ah0JxuA9vuXFSvdDET3CeXJAJGGPWnz/oxk0RA/pFv5yJ2FXGovWUZZSkBtJBk5ufSPxZNj5qunWKJCUOdaCwHPyD3hNtOPQ2A5nc8rw3yg5SGLZ3hA5UiwvMdE4OSyf9ji3AgdJAWeji+XiX8ZJ668BRQ3IE/aEVG6GAz3LbImJWGDbijvnNMND4ucizSr+MQTpIR37748OsxJ8I68GjufNRzEbni4hmFOBlToSO5cUB3jqFCJaQK9E6GBH125nR9vSC31FBQdlGKDaMf2CEn6kfrszQd1IraPCKogeNJNGAsrTPBGQ7g/hVrBOuX18+jw2FTM9WLIeoJl0/LfYXyd6rj6PYL6W1C+8X/HkgLriBdZmn8wge6OFHZsIs1CS1wURf2ZAUoVUBBD4wOq+3vEQ3AVif0Vy+1Ki6aUc/E5edf7/+E4TeItChR4WBxzxEmCbSlU7T2YZW6QOxdjG4g+sF4psZqr5lvgFFghQC9f317cJZklWyQSkfDXDdrZkI+NeHFIGzNTKcIubeiNiucV+SdKOmuEY3/Bob59B7J0f/eVq8f37ktWnxZNk4oJo/WptSR++SZJKX0P1eB/U73wkpZ6vLP1hkTpexXF6T5dt3kshYxt4LaT+HUi/jKA0FxBWEHxz+2J0A59ZbYv9pSvl+w4UnQlmvGoNn7/V6wG2/nhvfuhkmUDiqH/rZBgBSnuMxMpKaFioyDg5BF784Nz7xSI0Nuy3b1pJ96m6VTvGpqI4L4tZ1ufmeMEuxaqpUnANHWkI+g/Jtgs/wqak9O+2/XaE2OP0JYRUWJm8Yk/vnBx3EO0FQG7otp2JzokIp68hsUy/Z+Ao1esLdv/cHdClX4wzmBGvquf0XbX9XSRgzud2URBOHSz1Ny3MFXIHTviFbIsAiwLSNqKx+GeTOwhf21l33j2hkf90nB2kAMk9WEnallT1NL4sGn/k/8BEzYOwFQK2hy6JaAB+krb/k6yVCHDm+RpAJ76hcz0pXtQ3qFEg6offe5r80qV+EnoOrjWG8R33qIvP4oJCOuMdHPlG+rCDFma+/sp/03VpjFgm6pe/DrMdZyWzYriEbbMMG+y456fZxA8RuxSWBI+DO6OCy6u38enHPgZkF3CMkR684ymhr4DK7Kp9Gn/KGAaxNucoQi6q5+6vXIOP6hWDEiHHf4kkKKVwfXyo81SdQj91g2Isni0qNdZEcROki3XZr8TmIzbWLVxq2UlrexHgAqDwAu2aCCS/jXddh2p0dFDXl7dT1kUxMhATbuOpPOvxJ3JXtD7IMLsTRX2pgT3yY8RZIB5/HL2aYOnKFdAooyz1R8DLpTnoOLeyrpZuhST3R0SplbFLL69o3ytnGHf8ZvUBHj6pzhUU/Nrss90c6ahJF6EWaVUm7863S6jvhtO/U6JFXYGdZYM4UZhsf/KVIkqv9fZhXNmFqepESWbciTfAfdR8duzzVvr3ZQCzKyu0qbbd9oPnaUmV3TqEOksS6MrGt7VRIL5f1sc4/KZPF2OP4J9C8270fnDnoOdJb5st9zSum5ZVNcumoRPo/rjFhR454k4o9gvF38EKshX4YFcWrbZ7cN3xUdc4kl4BSohRjBqGwJq8Ea6bgjR3NSvtRji+IWHGFgwI+qv86nyM/3QSWkSXd4zMvFGntSCKkxghwcKeIuNGceN5gfZjdaGaFZfql1dW1h8/enuL7MwTLwlS5+e6yHA6fb89UDLlMYWyL4FwRkm8GijJtq7inyFOw1Pc8LdLD8P7yQLV73gjSdSQrgywno4WbRL2U17IYLSWVulrmYKTB7154+29Y5Cp+PHKS/1gloUyx0LEv//FDoNNq060XZMhASg+CfG2TTRFy/8qW60Ibs+HaP0bZiG9nXvg+4vQW1KxpkzayjZS7IFAie/ZUQ+iy8nWDDN0b5IBvMjSapaC/c166yWNcj+S0EDzaXf51fyGh6rBhGxfQYOZbEX6+hC/W+Zhdz48K5hU6tn1U2uGpikkeZaA7KX2cLpDXLGs6hl7QdO2HklEqiSsnHqEsDU/ugNFFJCe+7v4eGlpQDT3aZW1f4OruYwA07twlgMZvlUFt381o4QEvwgghXem+2U1V8Ng7QLS7S6M9iZ4ot/I4ACpGsmpUNJ0m8e4Nib34tO/lcV9QsB2+NqOG84001leQOuKKsIdN9Um6jkj9vkHOfGI1zS1rNE0zrJv/RSrQ2wwVZjH6UhVJtHZD5mLEnJ9HKEqHo6fBmQ+9cKGv58aiqaijEsv77X3IVCpizdaK9ezNEovbDaUPr37oajV36YdISztKp9MbWmMIIpSJ2R1W5X8tR9SAcwCMYtnDNAlNcxO2IuNU45SbvlS2M7m3Ao5NvRe9q9nnT8wNw4qu5Fx/LqxI5uXFp38Xh4SgBpRw7rjispWPJC8AruDMCwDkPRWYjSFzhssLC6J+NmlNCzIX0V8d9oxY6DwiWDsfnMjaT9WbWzoccZcogS2KzzaYdtH7+W4HEnLXJhffkSft++zHaFjmYAAB321gHkOYJNs4QBSx6Rt4ueMGobw5FQtEHJ/AdRA59K+wnisrkpyM7SCPWDUo3e8TVA4XKWV/rhPyr1jayXiK8vPnhoi5Sl69Jy2UpvLYXMl2Zyj4jftRZX75sE0Dg0QYI3FzAePkRzSrg6IxAOHN+g1c8Om454PKTTfp7bX4umN9ti5JFmwipLbsV8trI8y8KAqQ5OgcVpFz6P/kyHQl1wQa4KX/n5yAeOE6+CYuyG48uSbMRHs2aTXtmItNiRfY82jOcQfptxuuZmx8+igajQPJg0e7mnpSI0+sGU6tSlRruAChDxJJVcBOvGcmHecGfIWoRe/ZPbR7e71onE6Dg7VUyRXX51CKuU2J51eanOThjYOsW7Dc+4ZU+5KU8AbsOCGtxOo5LXg6IuIoBvj/f+G42JEkrdWO9IVqzX3mxrlUV0VSeqOO0nMabMT3VJU4cMX3dpFsoJBd4yIgGYkgUau1hd7JKfxPAlNedAjFwSXPvb7cA9Yf0TkbtalRfJoXxN/emeRssHJZ04xFms0kkrO8CirV92qbxoaidzeNr99McG5nlSd0e92Qp+ZZzLNbsNwUt7dxMOJVuqSSqoGDpUFq6GVbDfsnp0Bg1F7YEjmGM1eee2HP446kHzt26RjMhlJq2e7LBhg4pzpPgsGkplQTHQ/CDOoKuEe9CNsPUM13y4BFvLnHLxGmepzpbK/kj3++kJqzoutqzXvPqzRxUxE1R3cVb4k2XbJVLbj+oHyjdgZr0EIrcIjKPxrz8WiXC8drXAT58n85L98z0P4sc39g+1vOyKRzfMYEDWRnFediCr1jRqRtrTEaQQwrgNlr+cT2AzyTG4tzyae370lzt14anUR7ev5MdYSm2H4DNVgSwHhHPRT3kfS8a1p91/6h4/w4n//NrxBZZsNpA2aWfFfTpqNSkd4LKi4Zjg8WL/cts90rMn0qJu8i7IM4l5FFv5uB9L8l1DxWEiHtGcR+7squFpWXAzhFcQz991jhpo5lThApXPQGlffRyKWlM3acdxPs/aq+0EhXrfWNWoCkFhm2hmavjS3kCVKXQgrVUxz//dAgMQMIECRhnSv5TQAAAAAA=";

type AnimationSpec = {
  keyframes: Keyframe[];
  timing: KeyframeAnimationOptions;
};

const LOOP = Infinity;

const ANIMATIONS: Record<RodrigoState, AnimationSpec> = {
  idle: {
    keyframes: [
      { transform: "translateY(0px) rotate(-0.4deg) scale(1)" },
      { transform: "translateY(-3px) rotate(0.4deg) scale(1.012)" },
      { transform: "translateY(0px) rotate(-0.4deg) scale(1)" },
    ],
    timing: { duration: 3200, iterations: LOOP, easing: "ease-in-out" },
  },
  thinking: {
    keyframes: [
      { transform: "translateY(0px) rotate(-2.2deg) scale(1.01)" },
      { transform: "translateY(-2px) rotate(-1deg) scale(1.015)" },
      { transform: "translateY(0px) rotate(-2.2deg) scale(1.01)" },
    ],
    timing: { duration: 2600, iterations: LOOP, easing: "ease-in-out" },
  },
  listening: {
    keyframes: [
      { transform: "translateY(0px) scale(1.015)" },
      { transform: "translateY(1px) scale(1.035)" },
      { transform: "translateY(0px) scale(1.015)" },
    ],
    timing: { duration: 1800, iterations: LOOP, easing: "ease-in-out" },
  },
  working: {
    keyframes: [
      { transform: "translateY(0px) rotate(-0.8deg) scale(1.005)" },
      { transform: "translateY(-2px) rotate(0.8deg) scale(1.015)" },
      { transform: "translateY(0px) rotate(-0.8deg) scale(1.005)" },
    ],
    timing: { duration: 2100, iterations: LOOP, easing: "ease-in-out" },
  },
  approval: {
    keyframes: [
      { transform: "translateY(0px) scale(1)" },
      { transform: "translateY(-7px) scale(1.045)" },
      { transform: "translateY(0px) scale(1)" },
    ],
    timing: { duration: 700, iterations: LOOP, easing: "cubic-bezier(.2,.9,.3,1)" },
  },
  success: {
    keyframes: [
      { transform: "translateY(0px) scale(1)" },
      { transform: "translateY(-9px) scale(1.055)" },
      { transform: "translateY(0px) scale(1.01)" },
    ],
    timing: { duration: 850, iterations: LOOP, easing: "cubic-bezier(.2,.9,.3,1)" },
  },
  error: {
    keyframes: [
      { transform: "translateX(0px) rotate(0deg)" },
      { transform: "translateX(-4px) rotate(-1.6deg)" },
      { transform: "translateX(4px) rotate(1.6deg)" },
      { transform: "translateX(0px) rotate(0deg)" },
    ],
    timing: { duration: 650, iterations: LOOP, easing: "ease-in-out" },
  },
  disabled: {
    keyframes: [{ transform: "translateY(0px) scale(1)" }],
    timing: { duration: 1000, iterations: LOOP },
  },
};

export function Rodrigo3DMascot({ state }: { state: RodrigoState }) {
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      image.getAnimations().forEach((animation) => animation.cancel());
      return;
    }

    image.getAnimations().forEach((animation) => animation.cancel());
    const spec = ANIMATIONS[state];
    const animation = image.animate(spec.keyframes, spec.timing);
    return () => animation.cancel();
  }, [state]);

  const disabled = state === "disabled";
  const listening = state === "listening";

  return (
    <div
      aria-hidden="true"
      className="relative h-full w-full overflow-visible"
      style={{
        filter: listening ? "drop-shadow(0 0 10px rgba(56,189,248,.38))" : undefined,
      }}
    >
      <img
        ref={imageRef}
        src={RODRIGO_SRC}
        alt=""
        draggable={false}
        className="h-full w-full select-none object-contain"
        style={{
          transformOrigin: "50% 78%",
          opacity: disabled ? 0.58 : 1,
          filter: disabled ? "grayscale(1) saturate(.25)" : "none",
          transition: "filter 220ms ease, opacity 220ms ease",
          willChange: "transform",
        }}
      />
    </div>
  );
}
